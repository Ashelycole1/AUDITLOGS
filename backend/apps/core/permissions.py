"""Role-based access, default deny (architecture.md 5.1).

Every API view declares `allowed_roles`, either a tuple of roles for all methods or a dict of
method -> roles. A view that declares nothing refuses everyone. Public views (login, health)
opt out explicitly with `permission_classes = [AllowAny]`, and tests/test_permission_matrix.py
fails if any route is neither covered by the matrix nor listed as public.

On top of the role (auditlogs-additions_final.md 5 and 7):
- an organization's people are let in only while it is Active, and only in a role whose dashboard the
  System Administrator has switched on for it;
- a view may name a `required_feature`, refused unless it is on for the person's organization;
- the session carries the organization it was signed in to, and must still match the account.

Break-glass (design.md 12): a view marked `break_glass = True` lets ICT read, never write, and only
while ICT holds an approved, unexpired grant. Without one ICT is refused like any other role.
"""

from collections.abc import Iterable, Mapping

from django.conf import settings
from rest_framework.permissions import BasePermission

SESSION_ORG_KEY = "organization"


def session_org_value(user) -> str:
    return str(user.organization_id) if user.organization_id else "platform"


def organization_open(user) -> bool:
    """A System Administrator has no organization. Anyone else needs theirs to be Active."""
    if user.organization_id is None:
        return user.role == "SYS"
    return user.organization.is_active


def is_fully_authenticated(user) -> bool:
    """Signed in, active, of an Active organization, and past the MFA step. A password alone is not
    enough unless MFA is paused (MFA_REQUIRED=false, staging only; production refuses to start that way)."""
    if not (user and user.is_authenticated and user.is_active):
        return False
    if not organization_open(user):
        return False
    if not settings.MFA_REQUIRED:
        return True
    return callable(getattr(user, "is_verified", None)) and user.is_verified()


def roles_for(view, method: str) -> Iterable[str]:
    # A viewset may narrow roles for one action, e.g. reading is wider than editing.
    action_roles = getattr(view, "action_roles", None) or {}
    roles = action_roles.get(getattr(view, "action", None), getattr(view, "allowed_roles", None))
    if roles is None:
        return ()
    if isinstance(roles, Mapping):
        return roles.get(method, ())
    return roles


class RoleRequired(BasePermission):
    message = "You do not have access to this."

    def has_permission(self, request, view) -> bool:
        from apps.organizations.features import feature_enabled, role_enabled

        user = request.user
        if not is_fully_authenticated(user):
            return False
        if request.session.get(SESSION_ORG_KEY) != session_org_value(user):
            return False
        role = user.effective_role()
        if role not in roles_for(view, request.method):
            return False
        if role == "ICT" and getattr(view, "break_glass", False):
            from apps.compliance.models import has_active_grant

            if request.method not in ("GET", "HEAD", "OPTIONS") or not has_active_grant(user):
                return False
        if user.organization_id is None:
            return True
        if not role_enabled(user.organization, role):
            return False
        feature = getattr(view, "required_feature", None)
        return feature is None or feature_enabled(user.organization, feature)
