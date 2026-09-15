"""The only provider-egress boundary used by the local Core Service."""

from .credentials import (
    DEEPSEEK_CREDENTIAL_TARGET,
    PROVIDER_CREDENTIAL_TARGETS,
    CredentialRead,
    read_deepseek_api_key,
    read_deepseek_credential,
    read_provider_api_key,
    read_provider_credential,
)
from .deepseek import DeepSeekAdapter, OpenAICompatibleAdapter
from .runtime import (
    AgentRuntime,
    PayloadInspector,
    ProviderConfig,
    ProviderCompletion,
    ProviderFailure,
    ProviderFailureKind,
    ProviderResponse,
    ProviderRuntimeSet,
    StreamConsumerDisconnected,
)

__all__ = [
    "AgentRuntime",
    "DEEPSEEK_CREDENTIAL_TARGET",
    "PROVIDER_CREDENTIAL_TARGETS",
    "CredentialRead",
    "DeepSeekAdapter",
    "OpenAICompatibleAdapter",
    "PayloadInspector",
    "ProviderConfig",
    "ProviderCompletion",
    "ProviderFailure",
    "ProviderFailureKind",
    "ProviderResponse",
    "ProviderRuntimeSet",
    "StreamConsumerDisconnected",
    "read_deepseek_api_key",
    "read_deepseek_credential",
    "read_provider_api_key",
    "read_provider_credential",
]
