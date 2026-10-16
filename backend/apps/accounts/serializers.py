from rest_framework import serializers

from apps.core.validators import validate_reason

from .models import Role, User


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False)


class MfaSerializer(serializers.Serializer):
    code = serializers.RegexField(
        r"^\d{6}$", error_messages={"invalid": "Enter the 6-digit code from your authenticator app."}
    )


class UserSerializer(serializers.ModelSerializer):
    role_name = serializers.CharField(source="get_role_display", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "full_name",
            "role",
            "role_name",
            "is_active",
            "acting_cia_until",
            "created_at",
        ]
        read_only_fields = fields


class MeSerializer(UserSerializer):
    effective_role = serializers.CharField(read_only=True)

    class Meta(UserSerializer.Meta):
        fields = [*UserSerializer.Meta.fields, "effective_role"]
        read_only_fields = fields


class UserCreateSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=150)
    role = serializers.ChoiceField(choices=Role.choices)
    reason = serializers.CharField(required=False, allow_blank=True)

    def validate_email(self, value: str) -> str:
        value = value.strip().lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value


class UserUpdateSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False)
    full_name = serializers.CharField(max_length=150, required=False)
    role = serializers.ChoiceField(choices=Role.choices, required=False)
    reason = serializers.CharField(validators=[validate_reason])

    def validate_email(self, value: str) -> str:
        value = value.strip().lower()
        if User.objects.filter(email=value).exclude(pk=self.context["user"].pk).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value
