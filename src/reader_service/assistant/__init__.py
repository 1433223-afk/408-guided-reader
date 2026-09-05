"""Temporary Reader-native Assistant state and context assembly."""

from .context import AssistantContextBuilder, ScopeResolution, ScopeResolver
from .service import AssistantService

__all__ = ["AssistantContextBuilder", "AssistantService", "ScopeResolution", "ScopeResolver"]
