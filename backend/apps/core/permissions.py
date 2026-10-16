"""Role-based access, default deny (architecture.md 5.1).

Every API view declares `allowed_roles`, either a tuple of roles for all methods or a dict of
method -> roles. A view that declares nothing refuses everyone. Public views (login, health)
opt out explicitly with `permission_classes = [AllowAny]`, and tests/test_permission_matrix.py
fails if any route is neither covered by the matrix nor listed as public.
"""

from collections.abc import Iterable, Mapping

from rest_framework.permissions import BasePermission


def is_fully_authenticated(user) -> bool:
    """Signed in, active, and past the MFA step. A password alone is never enough."""
    return bool(
        user
        and user.is_authenticated
        and user.is_active
        and callable(getattr(user, "is_verified", None))
        and user.is_verified()
    )


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
        user = request.user
        if not is_fully_authenticated(user):
            return False
        return user.effective_role() in roles_for(view, request.method)
