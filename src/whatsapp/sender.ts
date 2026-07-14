import axios from 'axios';
import { logger } from '../middleware/logger';

const WA_BASE = 'https://graph.facebook.com/v20.0';

function headers() {
  return {
    Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export async function sendTextMessage(phoneNumberId: string, to: string, text: string): Promise<string> {
  const chunks = chunkText(text, 4000);
  let lastId = '';

  for (let i = 0; i < chunks.length; i++) {
    const response = await axios.post(
      `${WA_BASE}/${phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: chunks[i], preview_url: false } },
      { headers: headers() }
    );
    lastId = response.data?.messages?.[0]?.id ?? '';

    if (chunks.length > 1 && i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  return lastId;
}

export async function sendVoiceMessage(phoneNumberId: string, to: string, audioBuffer: Buffer): Promise<void> {
  try {
    // Upload media first
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'response.mp3', contentType: 'audio/mpeg' });
    form.append('messaging_product', 'whatsapp');

    const uploadResponse = await axios.post(
      `${WA_BASE}/${phoneNumberId}/media`,
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
    );

    const mediaId = uploadResponse.data.id;

    await axios.post(
      `${WA_BASE}/${phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'audio', audio: { id: mediaId } },
      { headers: headers() }
    );
  } catch (err) {
    logger.warn('[Sender] Voice message send failed:', err);
  }
}

export async function markAsRead(phoneNumberId: string, messageId: string): Promise<void> {
  try {
    await axios.post(
      `${WA_BASE}/${phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      { headers: headers() }
    );
  } catch { /* not critical */ }
}

function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let split = maxLen;
    const period = remaining.lastIndexOf('. ', maxLen);
    const newline = remaining.lastIndexOf('\n', maxLen);
    if (period > maxLen * 0.6) split = period + 2;
    else if (newline > maxLen * 0.6) split = newline + 1;
    chunks.push(remaining.slice(0, split).trim());
    remaining = remaining.slice(split).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}