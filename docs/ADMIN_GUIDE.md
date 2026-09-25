# Admin guide

This is a one-time job. After it, sales users schedule meetings without ever signing in to Google.

## What you need

- A Google account for the company (for example `sales@yourcompany.com`). Meetings are created on
  its calendar and the invitations come from it. A personal account works for a test.
- System Manager access to the site.

## 1. Google Cloud

1. Open <https://console.cloud.google.com> and create (or pick) a project.
2. **APIs & Services > Library**: enable the **Google Calendar API**.
3. **Google Auth Platform** (OAuth consent screen): choose **External** (or **Internal** if you use
   Google Workspace and only your own domain will use it).
   - While the app is in **Testing**, add the company account under **Test users**. Google expires
     the login after **7 days** in this mode, so meetings quietly stop getting Meet links until you
     authorize again. Publish the app (or use an Internal one) for a permanent setup.
   - The scope used is `https://www.googleapis.com/auth/calendar`.
4. **Clients > Create client**: type **Web application**.
   - **Authorized redirect URI**: exactly what **CRM Meetings Settings** shows under the guide,
     for example
     `https://crm.yourcompany.com?cmd=frappe.integrations.doctype.google_calendar.google_calendar.google_callback`
     (no trailing slash; `https` for a real site).
   - Copy the **Client ID** and **Client secret**.

A separate OAuth client for each environment (production, staging, your laptop) keeps things clean.

## 2. Frappe

1. **Google Settings**: tick **Enable** and paste the Client ID and Client secret.
2. **Google Calendar > New**:
   - **User**: the admin user who is authorizing
   - **Calendar Name**: for example `CRM Meetings` (Google creates a calendar with this name)
   - **Enable** and **Push to Google Calendar** ticked. Leave **Pull from Google Calendar** off,
     otherwise the whole personal calendar is imported.
   - Save, then click **Authorize Google Calendar Access** and sign in with the company account.
   You come back to Frappe with a Google Calendar ID filled in.
3. **CRM Meetings Settings**: choose that record as **Company Google Calendar** and save. If it was
   the only connected calendar, this was already done for you. Click **Test Google connection**.

## 3. Email and reminders

- Reminders and fallback invitation emails need an outgoing **Email Account**
  (Desk > Email Account, with "Enable Outgoing" ticked). The settings checklist warns you if it is missing.
- The **scheduler** must be running (`bench --site your-site.com enable-scheduler`). Reminders are
  checked every 5 minutes.
- Guests who are invited through Google get Google's own email. The app only sends its own email
  when Google could not do it (a Manual link, no calendar connected, or a Google error), and for
  reminders and **Notify guests**.

## 4. Settings explained

| Setting | What it does |
|---|---|
| Default provider | Google Meet, or Manual link (paste any URL) |
| Default duration | Length of a new meeting |
| Company Google Calendar | The calendar every meeting is created on |
| Use each user's own Google Calendar | If a user has connected their own calendar, they organize their own meetings |
| Send in-app CRM notifications | Team members are notified when a meeting is scheduled, changed or cancelled |
| Reminder (minutes before) / Early reminder | When reminders go out (0 turns the early one off) |
| Email reminders to CRM team members | Email as well as the in-app notification |
| Also email reminders to external guests | Off by default; Google already reminds guests |
| Show a "Schedule Meeting" button on Lead and Deal pages | Turn off if your CRM already has a Meetings tab |
| Show a "Meetings" button on the Leads and Deals list pages | The entry point to the calendar |

## 5. Who can do what

See the table in the README. Managers (System Manager, Sales Manager) see every meeting; sales
users see meetings they created or were invited to.

## Testing as a new sales user

Sales users never authorize Google. To see exactly what they will see:

1. **Desk > User > New**: an email, the role **Sales User**, and a password.
2. Make that user the **owner** of a test Lead or Deal (Lead Owner / Deal Owner). CRM only shows sales
   users the records they own, or that they can reach through the organization hierarchy.
3. Log in to the CRM as that user and open the Lead. **Schedule Meeting** (or **New Meeting** on the
   Meetings tab) creates the meeting on the *company* calendar, with a real Meet link, and nothing asks
   them to sign in to Google.
4. They see only their own meetings, and there is no **Mine / Everyone** switch (that is for managers).
5. To see what happens when setup is not finished, clear **Company Google Calendar** in CRM Meetings
   Settings. The editor then shows "Google Meet is not set up yet ... Ask your admin to finish the
   one-time setup." and the meeting is still saved, without a link. An admin sees an **Open setup** link
   in the same place. Put the calendar back afterwards.

Delete the test user, Lead and meetings when you are done. Cancelling a meeting removes its Google event.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Error 400: redirect_uri_mismatch` | The redirect URI in Google Cloud does not match the one in the settings guide. Copy it exactly. |
| `Access blocked ... invalid_request` | Google refuses non-`https` addresses other than `localhost`. Use `https`, or on a laptop open the site as `http://localhost:8000`. |
| `Error 403: access_denied` | The consent screen is in Testing and the account is not a Test user. Add it under Audience > Test users. |
| Meet links stopped after a week | The consent screen is in Testing (7-day login). Publish the app, then authorize again. |
| "Google Calendar API is not enabled" | Enable the Calendar API in the Google Cloud project. |
| "Google rejected the saved login" | The authorization expired or was revoked: open the Google Calendar record and authorize again. |
| A meeting has no Meet link | "Add a video meeting" was off, or no calendar is connected (the timeline comment says which). Open the meeting: the reason is shown. |
| Guests did not get an invitation | Invitations were switched off for that meeting (the timeline comment says "Guests were not notified"), or the Lead has no email. |
| No reminders | Scheduler off, no outgoing Email Account, or reminders disabled in the settings. The checklist shows the first two. |
| A sales user cannot see a meeting | They did not create it and were not added as a team-member guest. Add them as a guest, or make them a Sales Manager. |

## Good to know

- Google does not let you notify only the *new* guests of a change, so a change notifies everyone or nobody.
- Times are in the site's time zone (System Settings).
- The company account can see every meeting on its calendar, and guests see each other's addresses (Google's default).
- Deleting a meeting in Desk removes its Google event without emailing anyone; use **Cancel meeting** to tell the guests.
