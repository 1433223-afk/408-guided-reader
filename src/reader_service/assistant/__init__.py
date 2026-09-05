"""Temporary Reader-native Assistant state and context assembly."""

from .context import AssistantContextBuilder, ScopeResolution, ScopeResolver
from .service import AssistantService, AssistantStateError, SelectionSourceKind

__all__ = [
    "AssistantContextBuilder",
    "AssistantService",
    "AssistantStateError",
    "ScopeResolution",
    "ScopeResolver",
    "SelectionSourceKind",
]
