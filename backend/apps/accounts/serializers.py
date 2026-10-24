from rest_framework import serializers

from apps.core.validators import validate_reason
from apps.organizations.features import enabled_features, enabled_roles, role_enabled
from apps.organizations.logos import logo_url

from .models import ORG_ROLES, Role, User

ORG_ROLE_CHOICES = [(value, label) for value, label in Role.choices if value in ORG_ROLES]


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False)
    # The System Administrator signs in on a page of its own (auditlogs-additions_final.md 4).
    portal = serializers.ChoiceField(choices=["organization", "platform"], default="organization")


class SetPasswordSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=100)
    token = serializers.CharField(max_length=100)
    password = serializers.CharField(trim_whitespace=False, max_length=200)


class MfaSerializer(serializers.Serializer):
    code = serializers.RegexField(
        r"^\d{6}$", error_messages={"invalid": "Enter the 6-digit code from your authenticator app."}
    )


class UserSerializer(serializers.ModelSerializer):
    role_name = serializers.CharField(source="get_role_display", read_only=True)
    # False until the person has chosen a password from their enrolment link.
    has_password = serializers.SerializerMethodField()

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
            "has_password",
            "created_at",
        ]
        read_only_fields = fields

    def get_has_password(self, user) -> bool:
        return user.has_usable_password()


class ActingCiaSerializer(serializers.Serializer):
    until = serializers.DateTimeField()
    reason = serializers.CharField(validators=[validate_reason])


class MeSerializer(UserSerializer):
    """Who is signed in, with their organization and what it has switched on, so the app shows only
    those dashboards and widgets. The server enforces the same switches on every request."""

    effective_role = serializers.CharField(read_only=True)
    organization = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        fields = [*UserSerializer.Meta.fields, "effective_role", "organization"]
        read_only_fields = fields

    def get_organization(self, user) -> dict | None:
        org = user.organization
        if org is None:
            return None
        return {
            "id": str(org.pk),
            "name": org.name,
            "country": org.country,
            "address": org.address,
            "website": org.website,
            "logo_url": logo_url(org),
            "status": org.status,
            "features": sorted(enabled_features(org)),
            "roles": enabled_roles(org),
        }


def check_role_enabled(organization, role: str) -> str:
    """A role can be given only if its dashboard is on for the organization (section 5.2)."""
    if not role_enabled(organization, role):
        raise serializers.ValidationError(
            f"The {Role(role).label} role is not enabled for your organization. "
            "The platform administrator chooses which roles it has."
        )
    return role


class UserCreateSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=150)
    role = serializers.ChoiceField(choices=ORG_ROLE_CHOICES)
    reason = serializers.CharField(required=False, allow_blank=True)

    def validate_email(self, value: str) -> str:
        value = value.strip().lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_role(self, value: str) -> str:
        return check_role_enabled(self.context["organization"], value)


class UserUpdateSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False)
    full_name = serializers.CharField(max_length=150, required=False)
    role = serializers.ChoiceField(choices=ORG_ROLE_CHOICES, required=False)
    reason = serializers.CharField(validators=[validate_reason])

    def validate_role(self, value: str) -> str:
        return check_role_enabled(self.context["user"].organization, value)

    def validate_email(self, value: str) -> str:
        value = value.strip().lower()
        if User.objects.filter(email=value).exclude(pk=self.context["user"].pk).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value
