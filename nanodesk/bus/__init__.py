"""Message bus module for decoupled channel-agent communication."""

from nanodesk.bus.events import InboundMessage, OutboundMessage
from nanodesk.bus.queue import MessageBus

__all__ = ["MessageBus", "InboundMessage", "OutboundMessage"]
