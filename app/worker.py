import json
import asyncio
import time
import random
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

import httpx
from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import AsyncSessionLocal, MessageQueue, MessageStatus, DeadLetter
from app.security import get_security_manager
from app.webhook_handler import StateMachine

settings = get_settings()
security = get_security_manager()
state_machine = StateMachine()


class Worker:
    def __init__(self):
        self.running = True
        self.poll_interval = 5  # seconds
        self.batch_size = 10
    
    async def run(self):
        """Main worker loop - processes messages from queue."""
        print("Worker started - processing messages from queue")
        
        while self.running:
            try:
                async with AsyncSessionLocal() as session:
                    # Get pending messages (not completed or dead)
                    result = await session.execute(
                        select(MessageQueue).where(
                            and_(
                                MessageQueue.status.in_(["pending", "retry"]),
                                MessageQueue.next_attempt_at <= datetime.utcnow()
                            )
                        ).order_by(MessageQueue.created_at).limit(self.batch_size)
                    )
                    pending = result.scalars().all()
                    
                    if pending:
                        print(f"Found {len(pending)} messages to process")
                    
                    for item in pending:
                        if not self.running:
                            break
                        await self._process_item(session, item)
                        
            except Exception as e:
                print(f"Worker error: {e}")
            
            await asyncio.sleep(self.poll_interval)
        
        print("Worker stopped")
    
    async def _process_item(self, session: AsyncSession, item: MessageQueue):
        """Process a single queue item."""
        # Mark as processing
        await session.execute(
            update(MessageQueue).where(MessageQueue.id == item.id).values(
                status="processing",
                processed_at=datetime.utcnow()
            )
        )
        await session.commit()
        
        try:
            # Decrypt the payload
            normalized = json.loads(security.unseal_payload(item.payload_encrypted))
            
            # Handle status updates
            if normalized.get("event_type") == "status":
                await self._handle_status(session, normalized)
            
            # Forward to AI team if configured
            if settings.AI_TEAM_WEBHOOK_URL:
                await self._forward_to_ai(normalized)
            
            # Mark as completed
            await session.execute(
                update(MessageQueue).where(MessageQueue.id == item.id).values(
                    status="completed",
                    processed_at=datetime.utcnow()
                )
            )
            await session.commit()
            
            print(f"✅ Processed message: {item.event_id}")
            
        except Exception as e:
            error_str = str(e)
            
            if item.retry_count < settings.MAX_RETRIES:
                # Schedule retry with exponential backoff
                delay = min(
                    settings.RETRY_BASE_DELAY * (2 ** item.retry_count) + random.uniform(0, 1),
                    3600
                )
                next_attempt = datetime.utcnow() + timedelta(seconds=delay)
                
                await session.execute(
                    update(MessageQueue).where(MessageQueue.id == item.id).values(
                        status="retry",
                        retry_count=item.retry_count + 1,
                        next_attempt_at=next_attempt,
                        error=error_str
                    )
                )
                await session.commit()
                
                print(f"🔄 Retry {item.retry_count + 1}/{settings.MAX_RETRIES} for: {item.event_id} (in {delay:.1f}s)")
                
            else:
                # Move to dead letter
                dead = DeadLetter(
                    event_id=item.event_id,
                    payload_encrypted=item.payload_encrypted,
                    error=error_str,
                    retry_count=item.retry_count
                )
                session.add(dead)
                
                await session.execute(
                    update(MessageQueue).where(MessageQueue.id == item.id).values(
                        status="dead_letter",
                        processed_at=datetime.utcnow()
                    )
                )
                await session.commit()
                
                print(f"💀 Message dead: {item.event_id} - {error_str}")
    
    async def _handle_status(self, session: AsyncSession, normalized: Dict[str, Any]):
        """Handle WhatsApp status updates with state machine."""
        status = normalized.get("status")
        phone = normalized.get("phone_number", "")
        msg_id = normalized.get("message_id", "")
        timestamp = normalized.get("timestamp", 0)
        
        # Check if status already exists
        result = await session.execute(
            select(MessageStatus).where(
                and_(
                    MessageStatus.message_id == msg_id,
                    MessageStatus.status == status
                )
            )
        )
        existing = result.scalar_one_or_none()
        
        if not existing:
            new_status = MessageStatus(
                message_id=msg_id,
                phone_number=phone,
                status=status,
                timestamp=timestamp
            )
            session.add(new_status)
            await session.commit()
            print(f"📊 Status updated: {msg_id} -> {status}")
    
    async def _forward_to_ai(self, normalized: Dict[str, Any]):
        """Forward message to AI team endpoint."""
        if not settings.AI_TEAM_WEBHOOK_URL:
            return
        
        headers = {
            "Content-Type": "application/json",
            "X-Trace-ID": normalized.get("trace_id", ""),
            "X-Wax-ID": normalized.get("wax_id", "")
        }
        
        if settings.AI_TEAM_API_KEY:
            headers["X-API-Key"] = settings.AI_TEAM_API_KEY
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                settings.AI_TEAM_WEBHOOK_URL,
                json=normalized,
                headers=headers
            )
            response.raise_for_status()
            
            print(f"📤 Forwarded to AI team: {normalized.get('wax_id')} - Status: {response.status_code}")
    
    def stop(self):
        """Stop the worker gracefully."""
        self.running = False
        print("Stopping worker...")


async def run_worker():
    """Entry point for running the worker."""
    worker = Worker()
    
    try:
        await worker.run()
    except KeyboardInterrupt:
        worker.stop()
        print("Worker interrupted by user")


if __name__ == "__main__":
    asyncio.run(run_worker())