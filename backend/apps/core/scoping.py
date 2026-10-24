"""Row-level scoping for audit content (architecture.md 5.1, system.md 4.1).

A model that holds query data gives its QuerySet a `for_user(user)` method and is listed in
SCOPED_MODELS. Views reach it only through ScopedQuerysetMixin, so an IA's requests are filtered
in the database query itself, and object lookups outside the scope return 404, never 403.
tests/test_scoping.py fails if any API view reads a scoped model another way.
"""

from django.apps import apps


def scoped_models() -> set:
    return {apps.get_model(label) for label in SCOPED_MODEL_LABELS}


SCOPED_MODEL_LABELS = [
    "queries.Query",
    "queries.QueryRevision",
    "followup.FollowUpActivity",
    "followup.Evidence",
    "followup.Comment",
    "workflow.StatusChangeRequest",
    "workflow.ReassignmentRequest",
]


class BreakGlassMixin:
    """For views ICT may read under a break-glass grant: ICT's role is allowed in the view's roles only
    for reads, and RoleRequired checks the grant. Each request that gets past the checks is logged."""

    break_glass = True

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.user.effective_role() == "ICT":
            from apps.compliance.grants import log_read
            from apps.core.requests import client_ip

            log_read(
                actor=request.user,
                path=request.get_full_path(),
                object_id=kwargs.get("pk", "list"),
                ip=client_ip(request._request),
            )


class ScopedQuerysetMixin:
    """Use instead of `queryset = ...` for every model in SCOPED_MODELS."""

    scoped_model = None

    def get_queryset(self):
        if self.scoped_model is None:
            raise NotImplementedError("Set scoped_model on views that read audit content.")
        return self.scoped_model.objects.for_user(self.request.user)
