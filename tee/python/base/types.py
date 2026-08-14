"""Infrastructure types for the TEE extension framework."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional


@dataclass
class ActionData:
    """Nested 'data' field inside an Action."""

    id: str
    type: str
    submission_tag: str
    message: str  # JSON-encoded DataFixed


@dataclass
class Action:
    """Top-level request received on POST /action."""

    data: ActionData
    additional_variable_messages: list[str] = field(default_factory=list)
    timestamps: list[int] = field(default_factory=list)
    additional_action_data: str = ""
    signatures: list[str] = field(default_factory=list)


@dataclass
class DataFixed:
    """Decoded content of ActionData.message."""

    instruction_id: str
    op_type: str
    op_command: str
    tee_id: str = ""
    timestamp: int = 0
    reward_epoch_id: int = 0
    cosigners: list[str] = field(default_factory=list)
    cosigners_threshold: int = 0
    original_message: str = ""
    additional_fixed_message: str = ""


@dataclass
class ActionResult:
    """Response returned from POST /action."""

    id: str
    submission_tag: str
    status: int
    op_type: str
    op_command: str
    version: str
    log: Optional[str] = None
    additional_result_status: Optional[str] = None
    data: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id": self.id,
            "submissionTag": self.submission_tag,
            "status": self.status,
            "opType": self.op_type,
            "opCommand": self.op_command,
            "version": self.version,
        }
        if self.log is not None:
            d["log"] = self.log
        if self.additional_result_status is not None:
            d["additionalResultStatus"] = self.additional_result_status
        if self.data is not None:
            d["data"] = self.data
        return d


@dataclass
class StateResponse:
    """Response from GET /state."""

    state_version: str
    state: Any

    def to_dict(self) -> dict[str, Any]:
        return {
            "stateVersion": self.state_version,
            "state": self.state,
        }


# Handler function signature: (msg: str) -> (data: Optional[str], status: int, error: Optional[str])
HandlerFunc = Callable[[str], tuple[Optional[str], int, Optional[str]]]

# Report state function signature: () -> Any (JSON-serializable)
ReportStateFunc = Callable[[], Any]

# Register function signature: (framework: Framework) -> None
RegisterFunc = Callable[["Framework"], None]


def string_to_bytes32_hex(s: str) -> str:
    """Encode a UTF-8 string into a 0x-prefixed 32-byte zero-right-padded hex string."""
    b = s.encode("utf-8")
    padded = b.ljust(32, b"\x00")[:32]
    return "0x" + padded.hex()


def bytes32_hex_to_string(h: str) -> str:
    """Convert a 32-byte hex string back to a trimmed UTF-8 string."""
    h = h.removeprefix("0x")
    try:
        b = bytes.fromhex(h)
    except ValueError:
        return ""
    return b.rstrip(b"\x00").decode("utf-8", errors="replace")


def version_to_hex(version: str) -> str:
    """Convert a version string to bytes32 hex."""
    return string_to_bytes32_hex(version)


class Framework:
    """Provides handler registration to app code."""

    def __init__(self) -> None:
        self._handlers: list[tuple[str, str, HandlerFunc]] = []

    def handle(self, op_type: str, op_command: str, handler: HandlerFunc) -> None:
        """Register a handler for an OPType/OPCommand pair.

        Pass "" for op_command to match any command.
        """
        self._handlers.append((
            string_to_bytes32_hex(op_type),
            string_to_bytes32_hex(op_command),
            handler,
        ))

    def lookup(self, op_type: str, op_command: str) -> Optional[HandlerFunc]:
        """Find a handler matching the given opType and opCommand."""
        empty_cmd = string_to_bytes32_hex("")
        for reg_type, reg_cmd, handler in self._handlers:
            if reg_type != op_type:
                continue
            if reg_cmd == empty_cmd or reg_cmd == op_command:
                return handler
        return None


def parse_action(raw: dict[str, Any]) -> Action:
    """Parse a raw JSON dict into an Action."""
    data_raw = raw["data"]
    data = ActionData(
        id=data_raw["id"],
        type=data_raw["type"],
        submission_tag=data_raw["submissionTag"],
        message=data_raw["message"],
    )
    return Action(
        data=data,
        additional_variable_messages=raw.get("additionalVariableMessages", []),
        timestamps=raw.get("timestamps", []),
        additional_action_data=raw.get("additionalActionData", ""),
        signatures=raw.get("signatures", []),
    )


def parse_data_fixed(raw: dict[str, Any]) -> DataFixed:
    """Parse a raw JSON dict into a DataFixed."""
    return DataFixed(
        instruction_id=raw["instructionId"],
        op_type=raw["opType"],
        op_command=raw["opCommand"],
        tee_id=raw.get("teeId", ""),
        timestamp=raw.get("timestamp", 0),
        reward_epoch_id=raw.get("rewardEpochId", 0),
        cosigners=raw.get("cosigners", []),
        cosigners_threshold=raw.get("cosignersThreshold", 0),
        original_message=raw.get("originalMessage", ""),
        additional_fixed_message=raw.get("additionalFixedMessage", ""),
    )
