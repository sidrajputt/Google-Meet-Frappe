"""Everything the app sets up in a CRM site, on install and on every migrate.

All steps are idempotent: they add what is missing and never overwrite what an
admin has customised (settings, dashboard layout, the quick-entry layout).
"""

import json

import frappe

APP_VERSION_KEY = "crm_meetings_scripts_version"
SCRIPT_VERSION = "1"  # bump when the scripts below change
SCRIPT_PREFIX = "CRM Meetings"

NEXT_MEETING_FIELD = {
	"fieldname": "next_meeting_on",
	"fieldtype": "Datetime",
	"label": "Next Meeting",
	"read_only": 1,
	"no_copy": 1,
	"print_hide": 1,
	"report_hide": 0,
	"description": "Set automatically by CRM Meetings.",
}

# -- CRM scripts ----------------------------------------------------------------------
# Loaded by CRM's own script engine, so no CRM source file is ever edited.

LOADER = """// Managed by the CRM Meetings app. It is rewritten when the app updates - do not edit.
function crmMeetingsLoad() {
	if (window.crmMeetings) return Promise.resolve(window.crmMeetings)
	return new Promise((resolve, reject) => {
		const s = document.createElement("script")
		s.src = "/assets/crm_meetings/bridge.js?v=__VERSION__"
		s.onload = () => resolve(window.crmMeetings)
		s.onerror = () => reject(new Error("CRM Meetings could not be loaded"))
		document.head.appendChild(s)
	})
}
"""

FORM_SCRIPT = (
	LOADER
	+ """
class __CLASS__ {
	async onLoad() {
		let cm
		try { cm = await crmMeetingsLoad() } catch (e) { return }
		const config = await cm.config()
		if (!config.show_record_buttons) return
		// append, never replace: other scripts may have added their own buttons
		this.actions = [
			...(this.actions || []),
			{
				label: "Schedule Meeting",
				onClick: () => cm.openEditor({ reference_doctype: "__DT__", reference_docname: this.doc.name }),
			},
		]
	}
}
"""
)

LIST_SCRIPT = (
	LOADER
	+ """
async function setupList() {
	let cm
	try { cm = await crmMeetingsLoad() } catch (e) { return {} }
	const config = await cm.config()
	if (!config.show_list_button) return {}
	return {
		actions: [
			{ label: "Meetings", onClick: () => cm.openCalendar({ reference_doctype: "__DT__", view: "agenda" }) },
		],
	}
}
"""
)

SCRIPTS = [
	# (record name, doctype, view, class name, template)
	("Lead page", "CRM Lead", "Form", "CRMLead", FORM_SCRIPT),
	("Deal page", "CRM Deal", "Form", "CRMDeal", FORM_SCRIPT),
	("Leads list", "CRM Lead", "List", None, LIST_SCRIPT),
	("Deals list", "CRM Deal", "List", None, LIST_SCRIPT),
]

DASHBOARD_ITEMS = [
	# name, type, x, y-offset (rows below the current bottom), w, h
	("meetings_today", "number_chart", 0, 0, 4, 3),
	("upcoming_meetings_week", "number_chart", 4, 0, 4, 3),
	("meetings_in_period", "number_chart", 8, 0, 4, 3),
	("meetings_by_day", "axis_chart", 0, 3, 10, 9),
	("meetings_by_status", "donut_chart", 10, 3, 10, 9),
]


def after_install():
	run_all()


def after_migrate():
	run_all()


def run_all():
	if not frappe.db.exists("DocType", "CRM Lead"):
		return  # Frappe CRM is not on this site
	ensure_settings()
	ensure_custom_fields()
	ensure_quick_entry_layout()
	ensure_scripts()
	ensure_dashboard()
	backfill_next_meetings()


# -- settings ----------------------------------------------------------------------------


def ensure_settings():
	"""Create the settings with sensible defaults; auto-select a connected Google Calendar."""
	from crm_meetings.providers.google_meet import _usable

	first_time = not frappe.db.sql("select 1 from `tabSingles` where doctype = 'CRM Meetings Settings' limit 1")
	settings = frappe.get_doc("CRM Meetings Settings")
	changed = first_time

	if not settings.google_calendar:
		usable = [
			name
			for name in frappe.get_all(
				"Google Calendar", filters={"enable": 1, "push_to_google_calendar": 1}, pluck="name"
			)
			if _usable(name)
		]
		if len(usable) == 1:  # unambiguous: use it, the admin can change it later
			settings.google_calendar = usable[0]
			changed = True

	if changed:
		settings.flags.ignore_permissions = True
		settings.save()


def backfill_next_meetings():
	"""Fill the "Next Meeting" column for meetings that already exist."""
	from crm_meetings.utils import refresh_next_meeting

	for row in frappe.db.sql(
		"select distinct reference_doctype, reference_docname from `tabCRM Meeting` where status = 'Scheduled'"
	):
		refresh_next_meeting(*row)


# -- custom fields ------------------------------------------------------------------------


def ensure_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({dt: [NEXT_MEETING_FIELD] for dt in ("CRM Lead", "CRM Deal")}, ignore_validate=True)


# -- quick-entry layout (Desk / generic CRM dialogs) ---------------------------------------------

QUICK_ENTRY_LAYOUT = [
	{
		"name": "first_tab",
		"sections": [
			{"name": "meeting_section", "columns": [{"name": "meeting_column", "fields": ["subject"]}]},
			{
				"name": "time_section",
				"columns": [
					{"name": "starts_column", "fields": ["starts_on"]},
					{"name": "ends_column", "fields": ["ends_on"]},
				],
				"hideBorder": True,
			},
			{
				"name": "details_section",
				"columns": [{"name": "details_column", "fields": ["add_video_conferencing", "description"]}],
				"hideBorder": True,
			},
		],
	}
]


def ensure_quick_entry_layout():
	if not frappe.db.exists("DocType", "CRM Fields Layout"):
		return
	if frappe.db.exists("CRM Fields Layout", {"dt": "CRM Meeting", "type": "Quick Entry"}):
		return
	frappe.get_doc(
		{
			"doctype": "CRM Fields Layout",
			"dt": "CRM Meeting",
			"type": "Quick Entry",
			"layout": json.dumps(QUICK_ENTRY_LAYOUT),
		}
	).insert(ignore_permissions=True)


# -- CRM form / list scripts ----------------------------------------------------------------------


def _script_body(template, dt, cls):
	return template.replace("__VERSION__", SCRIPT_VERSION).replace("__DT__", dt).replace("__CLASS__", cls or "")


def ensure_scripts():
	"""Install or refresh the scripts that add the buttons to CRM. Standard scripts
	are read-only for admins outside developer mode, so they are updated in place."""
	if not frappe.db.exists("DocType", "CRM Form Script"):
		return
	for label, dt, view, cls, template in SCRIPTS:
		name = f"{SCRIPT_PREFIX}: {label}"
		body = _script_body(template, dt, cls)
		if frappe.db.exists("CRM Form Script", name):
			if frappe.db.get_value("CRM Form Script", name, "script") != body:
				frappe.db.set_value("CRM Form Script", name, {"script": body, "enabled": 1}, update_modified=False)
			continue
		frappe.get_doc(
			{
				"doctype": "CRM Form Script",
				"name": name,
				"dt": dt,
				"view": view,
				"enabled": 1,
				"is_standard": 1,
				"script": body,
			}
		).insert(ignore_permissions=True)


# -- dashboard ---------------------------------------------------------------------------------------


def ensure_dashboard():
	"""Add the meeting charts to the CRM dashboard once. After that the admin owns the
	layout: removing a chart from the dashboard is respected."""
	if not frappe.db.exists("DocType", "CRM Dashboard") or frappe.db.get_default("crm_meetings_dashboard_seeded"):
		return
	try:
		from crm.fcrm.doctype.crm_dashboard.crm_dashboard import create_default_manager_dashboard

		create_default_manager_dashboard()
		doc = frappe.get_doc("CRM Dashboard", "Manager Dashboard")
		layout = json.loads(doc.layout or "[]")
		present = {item.get("name") for item in layout}
		bottom = max((item["layout"]["y"] + item["layout"]["h"] for item in layout if item.get("layout")), default=0)
		for name, chart_type, x, dy, w, h in DASHBOARD_ITEMS:
			if name not in present:
				layout.append({"name": name, "type": chart_type, "layout": {"x": x, "y": bottom + dy, "w": w, "h": h, "i": name}})
		doc.layout = json.dumps(layout)
		doc.save(ignore_permissions=True)
		frappe.db.set_default("crm_meetings_dashboard_seeded", "1")
	except Exception:
		frappe.log_error(title="CRM Meetings: could not add the dashboard charts", message=frappe.get_traceback())


# -- uninstall ------------------------------------------------------------------------------------------


def before_uninstall():
	for name in frappe.get_all("CRM Form Script", filters={"name": ["like", f"{SCRIPT_PREFIX}:%"]}, pluck="name"):
		frappe.delete_doc("CRM Form Script", name, force=1, ignore_permissions=True)
	for dt in ("CRM Lead", "CRM Deal"):
		field = f"{dt}-{NEXT_MEETING_FIELD['fieldname']}"
		if frappe.db.exists("Custom Field", field):
			frappe.delete_doc("Custom Field", field, force=1, ignore_permissions=True)
	if frappe.db.exists("CRM Fields Layout", "CRM Meeting-Quick Entry"):
		frappe.delete_doc("CRM Fields Layout", "CRM Meeting-Quick Entry", force=1, ignore_permissions=True)
	if frappe.db.exists("CRM Dashboard", "Manager Dashboard"):
		doc = frappe.get_doc("CRM Dashboard", "Manager Dashboard")
		ours = {item[0] for item in DASHBOARD_ITEMS}
		layout = [i for i in json.loads(doc.layout or "[]") if i.get("name") not in ours]
		doc.layout = json.dumps(layout)
		doc.save(ignore_permissions=True)
	frappe.db.set_default("crm_meetings_dashboard_seeded", "")
