from . import __version__ as app_version  # noqa: F401

app_name = "crm_meetings"
app_title = "CRM Meetings"
app_publisher = "Coding Pro"
app_description = (
	"Schedule meetings from Frappe CRM with Google Meet and Google Calendar: guests, invitations, "
	"reminders, a calendar, dashboard charts and permissions. Installs like any other Frappe app."
)
app_email = "ss7858133@gmail.com"
app_license = "MIT"

required_apps = ["crm"]

# Set everything up on install, and re-check on every migrate (idempotent).
after_install = "crm_meetings.install.after_install"
after_migrate = "crm_meetings.install.after_migrate"
before_uninstall = "crm_meetings.install.before_uninstall"

# Managers see every meeting; sales users only the ones they made or were invited to.
permission_query_conditions = {"CRM Meeting": "crm_meetings.permissions.get_permission_query_conditions"}
has_permission = {"CRM Meeting": "crm_meetings.permissions.has_permission"}

scheduler_events = {
	"cron": {"*/5 * * * *": ["crm_meetings.notifications.send_due_reminders"]},
	"hourly": ["crm_meetings.utils.refresh_stale_next_meetings"],
}

# Charts for the CRM dashboard (CRM's own extension hook).
crm_dashboard_charts = {
	"number_chart": [
		{"label": "Meetings today", "value": "meetings_today", "resolver": "crm_meetings.dashboard.get_meetings_today"},
		{
			"label": "Meetings in the next 7 days",
			"value": "upcoming_meetings_week",
			"resolver": "crm_meetings.dashboard.get_upcoming_meetings_week",
		},
		{"label": "Meetings", "value": "meetings_in_period", "resolver": "crm_meetings.dashboard.get_meetings_in_period"},
	],
	"axis_chart": [
		{"label": "Meetings by day", "value": "meetings_by_day", "resolver": "crm_meetings.dashboard.get_meetings_by_day"}
	],
	"donut_chart": [
		{
			"label": "Meetings by status",
			"value": "meetings_by_status",
			"resolver": "crm_meetings.dashboard.get_meetings_by_status",
		}
	],
}

# CRM's get_dashboard leaves contributed charts empty; this fills them in.
override_whitelisted_methods = {"crm.api.dashboard.get_dashboard": "crm_meetings.dashboard.get_dashboard"}

# Extension point: register more meeting providers, for example
#   crm_meetings_providers = {"Zoom": "my_app.zoom.ZoomProvider"}
# crm_meetings_providers = {}
