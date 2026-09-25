"""Charts for the CRM dashboard, contributed through the ``crm_dashboard_charts`` hook.

Every resolver receives ``(from_date, to_date, user)``. CRM passes ``user`` for
sales users (so they only see their own numbers) and ``None`` for managers.
"""

import frappe
from frappe import _
from frappe.utils import add_days, date_diff, get_first_day, get_last_day, getdate, nowdate


def _scope(user):
	"""SQL that limits meetings to those a user created, organizes or was invited to."""
	if not user:
		return "", {}
	return (
		" and (m.owner = %(me)s or m.organizer = %(me)s or exists (select 1 from `tabCRM Meeting Attendee` a "
		"where a.parent = m.name and a.user = %(me)s))",
		{"me": user},
	)


def _count(start, end, user, statuses=("Scheduled", "Completed")):
	"""Meetings starting on [start, end] (inclusive dates)."""
	scope, params = _scope(user)
	params.update({"start": getdate(start), "end": add_days(getdate(end), 1), "statuses": statuses})
	return frappe.db.sql(
		f"""select count(*) from `tabCRM Meeting` m
		where m.starts_on >= %(start)s and m.starts_on < %(end)s and m.status in %(statuses)s {scope}""",
		params,
	)[0][0]


def _delta(current, previous):
	return (current - previous) / previous * 100 if previous else 0


def get_meetings_today(from_date=None, to_date=None, user=None):
	today = nowdate()
	current = _count(today, today, user, ("Scheduled",))
	yesterday = add_days(today, -1)
	return {
		"title": _("Meetings today"),
		"tooltip": _("Scheduled meetings that start today"),
		"value": current,
		"delta": _delta(current, _count(yesterday, yesterday, user)),
		"deltaSuffix": "%",
	}


def get_upcoming_meetings_week(from_date=None, to_date=None, user=None):
	today = nowdate()
	current = _count(today, add_days(today, 6), user, ("Scheduled",))
	return {
		"title": _("Meetings in the next 7 days"),
		"tooltip": _("Scheduled meetings starting in the next 7 days"),
		"value": current,
		"delta": 0,
		"deltaSuffix": "%",
	}


def get_meetings_in_period(from_date=None, to_date=None, user=None):
	span = max(date_diff(to_date, from_date), 1)
	current = _count(from_date, to_date, user)
	previous = _count(add_days(from_date, -span), add_days(from_date, -1), user)
	return {
		"title": _("Meetings"),
		"tooltip": _("Meetings scheduled in the selected period"),
		"value": current,
		"delta": _delta(current, previous),
		"deltaSuffix": "%",
	}


def get_meetings_by_day(from_date=None, to_date=None, user=None):
	scope, params = _scope(user)
	params.update({"start": getdate(from_date), "end": add_days(getdate(to_date), 1)})
	rows = frappe.db.sql(
		f"""select date(m.starts_on) as day, count(*) as meetings from `tabCRM Meeting` m
		where m.starts_on >= %(start)s and m.starts_on < %(end)s and m.status != 'Cancelled' {scope}
		group by date(m.starts_on) order by day""",
		params,
		as_dict=True,
	)
	return {
		"data": [{"date": r.day.strftime("%Y-%m-%d"), "meetings": r.meetings} for r in rows],
		"title": _("Meetings by day"),
		"subtitle": _("How many meetings are scheduled each day"),
		"xAxis": {"title": _("Date"), "key": "date", "type": "time", "timeGrain": "day"},
		"yAxis": {"title": _("Meetings")},
		"series": [{"name": "meetings", "type": "bar"}],
	}


def get_meetings_by_status(from_date=None, to_date=None, user=None):
	scope, params = _scope(user)
	params.update({"start": getdate(from_date), "end": add_days(getdate(to_date), 1)})
	rows = frappe.db.sql(
		f"""select m.status as status, count(*) as meetings from `tabCRM Meeting` m
		where m.starts_on >= %(start)s and m.starts_on < %(end)s {scope} group by m.status""",
		params,
		as_dict=True,
	)
	return {
		"data": [{"status": _(r.status), "meetings": r.meetings} for r in rows],
		"title": _("Meetings by status"),
		"subtitle": _("Scheduled, completed and cancelled"),
		"categoryColumn": "status",
		"valueColumn": "meetings",
	}


@frappe.whitelist()
def get_dashboard(from_date=None, to_date=None, user=None):
	"""CRM's dashboard data, plus the data of charts contributed by apps.

	CRM's own ``get_dashboard`` only fills in its built-in charts by name, so a
	contributed chart that is saved in the dashboard layout would come back
	empty (and crash the number-chart component). Registered in hooks.py through
	``override_whitelisted_methods``.
	"""
	from crm.api import dashboard as core

	layout = core.get_dashboard(from_date, to_date, user)
	pending = [item for item in layout if item.get("data") is None and item.get("type") != "spacer"]
	if not pending or not hasattr(core, "get_contributed_charts"):
		return layout

	resolvers = {
		option["value"]: option["resolver"]
		for options in core.get_contributed_charts().values()
		for option in options
	}

	# the same date range and user scoping CRM applies to its own charts
	if not from_date or not to_date:
		from_date = get_first_day(from_date or nowdate())
		to_date = get_last_day(to_date or nowdate())
	roles = frappe.get_roles(frappe.session.user)
	is_manager = "Sales Manager" in roles or "System Manager" in roles
	if "Sales User" in roles and not is_manager:
		user = frappe.session.user

	for item in pending:
		resolver = resolvers.get(item.get("name"))
		if resolver:
			try:
				item["data"] = frappe.get_attr(resolver)(from_date, to_date, user)
			except Exception:
				frappe.log_error(frappe.get_traceback(), f"CRM Meetings: dashboard chart {item.get('name')} failed")
	return layout
