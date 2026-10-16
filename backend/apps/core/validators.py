from rest_framework import serializers

MIN_REASON = 10


def validate_reason(value: str) -> str:
    """Reasons are required for recorded changes and must say something (design.md 13)."""
    value = (value or "").strip()
    if len(value) < MIN_REASON:
        raise serializers.ValidationError(
            f"Give a reason of at least {MIN_REASON} characters. It is saved in the audit log."
        )
    return value


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(validators=[validate_reason], trim_whitespace=True)
