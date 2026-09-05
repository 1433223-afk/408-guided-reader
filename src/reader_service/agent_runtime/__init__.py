"""The only provider-egress boundary used by the local Core Service."""

from .credentials import DEEPSEEK_CREDENTIAL_TARGET, read_deepseek_api_key
from .deepseek import DeepSeekAdapter
from .runtime import (
    AgentRuntime,
    PayloadInspector,
    ProviderConfig,
    ProviderFailure,
    ProviderFailureKind,
)

__all__ = [
    "AgentRuntime",
    "DEEPSEEK_CREDENTIAL_TARGET",
    "DeepSeekAdapter",
    "PayloadInspector",
    "ProviderConfig",
    "ProviderFailure",
    "ProviderFailureKind",
    "read_deepseek_api_key",
]
