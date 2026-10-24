"""What each organization gets (auditlogs-additions_final.md 5).

The System Administrator switches dashboards and dashboard components per organization. A missing row
means off. A role whose dashboard is off cannot be held or used; ICT Admin is always on, and the IA
dashboard must stay on so the organization can work its queries.
"""

DASHBOARD_ROLES = ("IA", "SIA", "PIA", "CIA", "CEO")
ALWAYS_ON_ROLES = ("ICT",)


def dashboard_key(role: str) -> str:
    return f"dashboard.{role}"


REGISTERED_NUMBERS = "component.registered_numbers"
SYSTEM_STATS = "component.system_stats"
STATUS_PIE = "component.status_pie"
COMPONENTS = (REGISTERED_NUMBERS, SYSTEM_STATS, STATUS_PIE)

FEATURE_KEYS = (*(dashboard_key(r) for r in DASHBOARD_ROLES), *COMPONENTS)
LABELS = {
    dashboard_key("IA"): "IA dashboard",
    dashboard_key("SIA"): "SIA dashboard",
    dashboard_key("PIA"): "PIA dashboard",
    dashboard_key("CIA"): "CIA dashboard",
    dashboard_key("CEO"): "CEO dashboard",
    REGISTERED_NUMBERS: "Registered numbers",
    SYSTEM_STATS: "System stats",
    STATUS_PIE: "Query status pie chart",
}
# Switches that can never be off (section 5.2, safeguards).
REQUIRED = (dashboard_key("IA"),)

PRESETS = {
    "full": {key: True for key in FEATURE_KEYS},
    "core": {
        **{key: True for key in FEATURE_KEYS},
        dashboard_key("SIA"): False,
    },
}
PRESET_LABELS = {"full": "Full", "core": "Core: IA, PIA, CIA, CEO"}
# Given to a new organization on approval unless the System Administrator chooses otherwise.
DEFAULT_PRESET = "full"


def enabled_features(organization) -> frozenset[str]:
    """The organization's switched-on features, read once per object (so once per request)."""
    if organization is None:
        return frozenset()
    cached = getattr(organization, "_enabled_features", None)
    if cached is None:
        cached = frozenset(organization.features.filter(enabled=True).values_list("feature_key", flat=True))
        organization._enabled_features = cached
    return cached


def feature_enabled(organization, key: str) -> bool:
    return key in enabled_features(organization)


def role_enabled(organization, role: str) -> bool:
    if role in ALWAYS_ON_ROLES:
        return True
    if role not in DASHBOARD_ROLES:
        return False
    return feature_enabled(organization, dashboard_key(role))


def enabled_roles(organization) -> list[str]:
    return [r for r in (*DASHBOARD_ROLES, *ALWAYS_ON_ROLES) if role_enabled(organization, r)]
