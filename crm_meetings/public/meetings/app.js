/* CRM Meetings - calendar UI (Vue 3, no build step).
 * Works inside CRM (embedded through bridge.js) and as a standalone page. */
(() => {
	const { createApp, ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue

	// ------------------------------------------------------------------ environment
	const params = new URLSearchParams(location.search)
	const EMBED = params.get('embed') === '1'
	const MODE = params.get('mode') === 'editor' ? 'editor' : 'calendar'
	const HOUR = 48 // px per hour in the week / day grid

	function applyTheme() {
		let theme = params.get('theme')
		try {
			if (window.parent !== window) theme = window.parent.document.documentElement.getAttribute('data-theme') || theme
		} catch (e) { /* cross-origin parent: keep the URL value */ }
		if (!theme) theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
		document.documentElement.setAttribute('data-theme', theme)
	}
	applyTheme()
	try {
		new MutationObserver(applyTheme).observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
	} catch (e) { /* not embedded */ }

	function tellParent(type, extra) {
		if (window.parent !== window) window.parent.postMessage({ source: 'crm-meetings', type, ...(extra || {}) }, location.origin)
	}

	// ------------------------------------------------------------------ api
	let csrf = null
	async function token() {
		if (csrf) return csrf
		try {
			const t = window.parent !== window && window.parent.csrf_token
			if (t && t !== '{{ csrf_token }}') csrf = t
		} catch (e) { /* ignore */ }
		if (!csrf) {
			const r = await fetch('/api/method/crm_meetings.api.get_csrf_token', { credentials: 'same-origin' })
			csrf = (await r.json()).message
		}
		return csrf
	}
	const stripHtml = (s) => { const d = document.createElement('div'); d.innerHTML = s; return d.textContent || '' }
	function errorText(body, status) {
		try {
			const msgs = JSON.parse(body._server_messages || '[]').map((m) => JSON.parse(m).message)
			if (msgs.length) return stripHtml(msgs.join(' '))
		} catch (e) { /* fall through */ }
		if (status === 401 || status === 403 && !body.exception) return 'Your session has expired. Please log in to the CRM again.'
		if (body.exception) return stripHtml(String(body.exception).replace(/^[\w.]+:\s*/, ''))
		return 'Something went wrong (' + status + ').'
	}
	async function call(method, args) {
		const res = await fetch('/api/method/' + method, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Frappe-CSRF-Token': await token() },
			body: JSON.stringify(args || {}),
		})
		let body = {}
		try { body = await res.json() } catch (e) { /* not json */ }
		if (!res.ok) throw new Error(errorText(body, res.status))
		return body.message
	}

	// ------------------------------------------------------------------ dates
	const pad = (n) => String(n).padStart(2, '0')
	const toSql = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`
	const dateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
	const timeInput = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
	const fromSql = (s) => new Date(String(s).replace(' ', 'T'))
	const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
	const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())
	const addMin = (d, n) => new Date(d.getTime() + n * 60000)
	const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
	const startOfWeek = (d) => { const x = sod(d); return addDays(x, -((x.getDay() + 6) % 7)) } // Monday
	const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
	const fmtDay = (d, o) => d.toLocaleDateString([], o || { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
	const clockLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })
	function whenText(m) {
		const s = fromSql(m.starts_on), e = fromSql(m.ends_on)
		return sameDay(s, e) ? `${fmtDay(s)} · ${fmtTime(s)} – ${fmtTime(e)}` : `${fmtDay(s)}, ${fmtTime(s)} – ${fmtDay(e)}, ${fmtTime(e)}`
	}
	function shortRange(m) {
		const s = fromSql(m.starts_on), e = fromSql(m.ends_on)
		return sameDay(s, e) ? `${fmtTime(s)} – ${fmtTime(e)}` : `${fmtTime(s)} – ${fmtDay(e, { day: 'numeric', month: 'short' })}, ${fmtTime(e)}`
	}
	const isEmail = (s) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s)
	const statusClass = (m) => (m.status || 'Scheduled').toLowerCase()
	const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }

	// ------------------------------------------------------------------ icons
	const ICONS = {
		calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
		'calendar-check': '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>',
		'chevron-left': '<path d="m15 18-6-6 6-6"/>',
		'chevron-right': '<path d="m9 18 6-6-6-6"/>',
		external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
		x: '<path d="M18 6 6 18M6 6l12 12"/>',
		plus: '<path d="M5 12h14M12 5v14"/>',
		video: '<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
		clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
		user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
		contact: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="11" r="3"/><path d="M7 18c1-2 3-3 5-3s4 1 5 3"/>',
		text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
		alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
	}
	const Ico = {
		props: { name: String, size: String },
		computed: { paths() { return ICONS[this.name] || '' } },
		template: `<svg class="ico" :class="size" viewBox="0 0 24 24" aria-hidden="true" v-html="paths"></svg>`,
	}

	// ------------------------------------------------------------------ small components
	const Avatar = {
		props: { name: String, email: String, size: String },
		computed: {
			label() { return this.name || this.email || '?' },
			initials() {
				const parts = String(this.label).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
				return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
			},
			color() {
				let h = 0
				for (const c of String(this.email || this.label)) h = (h * 31 + c.charCodeAt(0)) % 360
				return `hsl(${h} 42% 42%)`
			},
		},
		template: `<span class="avatar" :class="size" :style="{ background: color }" :title="label">{{ initials }}</span>`,
	}

	const Avatars = {
		components: { Avatar },
		props: { guests: Array, max: { type: Number, default: 4 } },
		template: `<span class="avatars" v-if="guests && guests.length">
			<avatar v-for="g in guests.slice(0, max)" :key="g.email" :name="g.full_name" :email="g.email" />
			<span v-if="guests.length > max" class="avatar more">+{{ guests.length - max }}</span></span>`,
	}

	// ------------------------------------------------------------------ editor
	const Editor = {
		components: { Avatar, Ico },
		props: { meeting: Object, preset: Object, config: Object, embedded: Boolean },
		emits: ['saved', 'close'],
		setup(props, { emit }) {
			const isNew = !props.meeting || !props.meeting.name
			const now = new Date()
			const roundedNow = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() < 30 ? 30 : 60)
			const start0 = props.meeting ? fromSql(props.meeting.starts_on) : (props.preset && props.preset.start) || roundedNow
			const end0 = props.meeting ? fromSql(props.meeting.ends_on) : addMin(start0, props.config.default_duration || 30)

			const f = reactive({
				subject: props.meeting ? props.meeting.subject : '',
				date: dateInput(start0),
				start: timeInput(start0),
				end: timeInput(end0),
				description: props.meeting ? props.meeting.description || '' : '',
				provider: props.meeting ? props.meeting.provider || props.config.default_provider : props.config.default_provider,
				addVideo: props.meeting ? !!props.meeting.add_video_conferencing : !!props.config.default_add_video_meeting,
				link: props.meeting && props.meeting.provider === 'Manual Link' ? props.meeting.google_meet_link || '' : '',
				notify: true,
			})
			const record = reactive({
				doctype: (props.meeting && props.meeting.reference_doctype) || (props.preset && props.preset.reference_doctype) || 'CRM Lead',
				name: (props.meeting && props.meeting.reference_docname) || (props.preset && props.preset.reference_docname) || '',
				title: (props.meeting && props.meeting.reference_title) || (props.preset && props.preset.reference_title) || '',
			})
			const locked = !!record.name && (!isNew || !!(props.preset && props.preset.reference_docname))
			const guests = ref(props.meeting ? props.meeting.attendees.map((g) => ({ ...g })) : [])
			let guestsTouched = !isNew
			const error = ref('')
			const saving = ref(false)

			// duration bookkeeping: moving the start keeps the length
			const dur = ref(Math.max(15, Math.round((end0 - start0) / 60000)))
			const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
			const setEnd = (mins) => { const e = Math.min(mins, 24 * 60 - 1); f.end = `${pad(Math.floor(e / 60))}:${pad(e % 60)}` }
			function onStart() { setEnd(minutes(f.start) + dur.value) }
			function onEnd() { const d = minutes(f.end) - minutes(f.start); if (d > 0) dur.value = d }
			function setDuration(mins) { dur.value = mins; setEnd(minutes(f.start) + mins) }
			const durations = [15, 30, 45, 60]
			const durLabel = (d) => (d < 60 ? `${d} min` : '1 hour')

			// related record picker
			const recQuery = ref('')
			const recResults = ref([])
			const recOpen = ref(false)
			const searchRecords = debounce(async () => {
				try { recResults.value = await call('crm_meetings.api.search_records', { doctype: record.doctype, txt: recQuery.value }) } catch (e) { recResults.value = [] }
			}, 200)
			watch([recQuery, () => record.doctype], () => { if (recOpen.value) searchRecords() })
			function openRecords() { recOpen.value = true; searchRecords() }
			async function pickRecord(r) {
				record.name = r.name; record.title = r.title; recOpen.value = false; recQuery.value = ''
				if (!guestsTouched) await loadDefaultGuests()
			}
			function clearRecord() { record.name = ''; record.title = '' }
			async function loadDefaultGuests() {
				if (!record.name) return
				try { guests.value = await call('crm_meetings.api.get_default_guests', { reference_doctype: record.doctype, reference_docname: record.name }) } catch (e) { /* keep list */ }
			}
			if (isNew && record.name) loadDefaultGuests()
			if (record.name && !record.title) {
				call('crm_meetings.api.get_reference', { reference_doctype: record.doctype, reference_docname: record.name })
					.then((r) => { record.title = r.title }).catch(() => { record.title = record.name })
			}

			// guests
			const gq = ref('')
			const suggestions = ref([])
			const gOpen = ref(false)
			const hi = ref(0)
			const sugFor = ref('')
			const searchGuests = debounce(async () => {
				const asked = gq.value
				try {
					suggestions.value = await call('crm_meetings.api.search_guests', { txt: asked })
					sugFor.value = asked
					hi.value = 0
				} catch (e) { suggestions.value = [] }
			}, 180)
			watch(gq, () => { gOpen.value = true; searchGuests() })
			// only suggestions for what is typed right now, never a stale search
			const freshSuggestions = computed(() => sugFor.value !== gq.value ? [] : suggestions.value.filter((s) => !guests.value.some((g) => g.email.toLowerCase() === s.email.toLowerCase())))
			function addGuest(g) {
				const email = (g.email || '').trim().toLowerCase()
				if (!isEmail(email)) { error.value = `"${g.email}" is not a valid email address.`; return }
				error.value = ''
				guestsTouched = true
				if (!guests.value.some((x) => x.email.toLowerCase() === email)) guests.value.push({ email, full_name: g.full_name || '', attendee_type: g.attendee_type || 'Guest' })
				gq.value = ''; gOpen.value = false
			}
			function removeGuest(i) { guestsTouched = true; guests.value.splice(i, 1) }
			function commitTyped() {
				const t = gq.value.trim().replace(/[,;]$/, '')
				if (freshSuggestions.value[hi.value] && !isEmail(t)) return addGuest(freshSuggestions.value[hi.value])
				if (t) addGuest({ email: t })
			}
			function onGuestKey(e) {
				if (e.key === 'Enter') { e.preventDefault(); commitTyped() }
				else if (e.key === ',' || e.key === ';') { e.preventDefault(); commitTyped() }
				else if (e.key === 'ArrowDown') { e.preventDefault(); hi.value = Math.min(hi.value + 1, freshSuggestions.value.length - 1) }
				else if (e.key === 'ArrowUp') { e.preventDefault(); hi.value = Math.max(hi.value - 1, 0) }
				else if (e.key === 'Backspace' && !gq.value && guests.value.length) removeGuest(guests.value.length - 1)
			}
			function closeGuestsSoon() { setTimeout(() => { gOpen.value = false; if (isEmail(gq.value.trim())) commitTyped() }, 150) }

			// when shown as its own panel inside the CRM, tell it how tall the form is
			const formEl = ref(null)
			let watcher = null
			onMounted(() => {
				if (!props.embedded || !formEl.value || !window.ResizeObserver) return
				const report = () => tellParent('resize', { height: [...formEl.value.children].reduce((n, el) => n + (el.classList.contains('dialog-body') ? el.scrollHeight : el.offsetHeight), 0) })
				watcher = new ResizeObserver(report)
				;[...formEl.value.children].forEach((el) => watcher.observe(el))
				report()
			})
			onBeforeUnmount(() => watcher && watcher.disconnect())
			const providerInfo = computed(() => props.config.providers.find((p) => p.key === f.provider))
			const heading = isNew ? 'New meeting' : 'Edit meeting'
			const setupNotice = computed(() => {
				const info = providerInfo.value
				if (!info || info.ready) return ''
				return props.config.is_manager
					? `${info.label} is not set up yet, so this meeting is saved without a meeting link.`
					: `${info.label} is not set up yet, so this meeting is saved without a meeting link. Ask your admin to finish the one-time setup.`
			})

			async function save() {
				error.value = ''
				const subject = f.subject.trim()
				if (!subject) return (error.value = 'Give the meeting a title.')
				if (!record.name) return (error.value = 'Choose the Lead or Deal this meeting is for.')
				const starts = `${f.date} ${f.start}:00`, ends = `${f.date} ${f.end}:00`
				if (minutes(f.end) <= minutes(f.start)) return (error.value = 'The meeting must end after it starts.')
				if (f.provider === 'Manual Link' && f.addVideo && !/^https?:\/\//i.test(f.link.trim())) return (error.value = 'Paste the full meeting link, starting with https://')
				if (gq.value.trim()) commitTyped()
				if (error.value) return
				saving.value = true
				try {
					const data = {
						subject, starts_on: starts, ends_on: ends, provider: f.provider,
						add_video_conferencing: f.addVideo ? 1 : 0, description: f.description,
						attendees: guests.value.map((g) => ({ email: g.email, full_name: g.full_name })),
					}
					if (f.provider === 'Manual Link') data.google_meet_link = f.link.trim()
					if (isNew) { data.reference_doctype = record.doctype; data.reference_docname = record.name } else data.name = props.meeting.name
					emit('saved', await call('crm_meetings.api.save_meeting', { data, notify: f.notify ? 'all' : 'none' }))
				} catch (e) { error.value = e.message } finally { saving.value = false }
			}
			return {
				isNew, f, record, locked, guests, error, saving, durations, dur, durLabel, onStart, onEnd, setDuration, minutes, setupUrl: '/app/crm-meetings-settings',
				recQuery, recResults, recOpen, openRecords, pickRecord, clearRecord,
				gq, gOpen, hi, freshSuggestions, addGuest, removeGuest, onGuestKey, closeGuestsSoon,
				formEl, providerInfo, setupNotice, heading, save, close: () => emit('close'),
			}
		},
		template: `
<div :class="embedded ? 'overlay-embedded' : 'overlay'" @mousedown.self="close">
<form class="dialog" :class="{ embedded }" ref="formEl" @submit.prevent="save" novalidate>
	<div class="dialog-head"><h2>{{ heading }}</h2><button type="button" class="btn ghost icon" @click="close" aria-label="Close"><ico name="x" size="lg" /></button></div>
	<div class="dialog-body">
		<div class="field"><input class="title" type="text" v-model="f.subject" placeholder="Add a title" autofocus /></div>

		<div class="field">
			<label class="lbl">Related to</label>
			<div v-if="record.name" class="record-lock">
				<span class="chip">{{ record.doctype === 'CRM Deal' ? 'Deal' : 'Lead' }}</span>
				<b>{{ record.title }}</b>
				<button v-if="!locked" type="button" class="btn ghost small" @click="clearRecord">Change</button>
			</div>
			<div v-else class="pick">
				<div class="related">
					<div class="seg"><button type="button" :class="{ on: record.doctype === 'CRM Lead' }" @click="record.doctype = 'CRM Lead'">Lead</button><button type="button" :class="{ on: record.doctype === 'CRM Deal' }" @click="record.doctype = 'CRM Deal'">Deal</button></div>
					<input class="control" type="text" v-model="recQuery" @focus="openRecords" @blur="() => setTimeout(() => (recOpen = false), 150)" placeholder="Search by name or email" />
				</div>
				<div class="suggest" v-if="recOpen && recResults.length">
					<button type="button" v-for="r in recResults" :key="r.name" @mousedown.prevent="pickRecord(r)"><avatar :name="r.title" size="lg" /><span><div class="n">{{ r.title }}</div><div class="sub">{{ r.email || r.name }}</div></span></button>
				</div>
			</div>
		</div>

		<div class="field">
			<label class="lbl">When</label>
			<div class="when">
				<input class="control f-date" type="date" v-model="f.date" />
				<input class="control f-time" type="time" v-model="f.start" @change="onStart" />
				<span class="sub">to</span>
				<input class="control f-time" type="time" v-model="f.end" @change="onEnd" />
			</div>
			<div class="pills"><button type="button" class="pill" :class="{ on: dur === d }" v-for="d in durations" :key="d" @click="setDuration(d)">{{ durLabel(d) }}</button></div>
		</div>

		<div class="field">
			<label class="lbl">Guests</label>
			<div class="tags">
				<span class="tag" v-for="(g, i) in guests" :key="g.email"><avatar :name="g.full_name" :email="g.email" /><span class="txt">{{ g.full_name || g.email }} <small v-if="g.full_name">{{ g.email }}</small></span><button type="button" class="x" @click="removeGuest(i)" :aria-label="'Remove ' + g.email">×</button></span>
				<input type="text" v-model="gq" @keydown="onGuestKey" @blur="closeGuestsSoon" @focus="gOpen = true" placeholder="Add people by name or email" />
				<div class="suggest" v-if="gOpen && freshSuggestions.length">
					<button type="button" v-for="(s, i) in freshSuggestions" :key="s.email" :class="{ on: i === hi }" @mousedown.prevent="addGuest(s)"><avatar :name="s.full_name" :email="s.email" size="lg" /><span><div class="n">{{ s.full_name || s.email }}</div><div class="sub">{{ s.email }} · {{ s.attendee_type }}</div></span></button>
				</div>
			</div>
			<div class="hint">Team members, contacts, or any email address. Press Enter to add.</div>
		</div>

		<div class="field">
			<div class="video-row">
				<label class="check"><input type="checkbox" v-model="f.addVideo" /> <ico name="video" /> Add a video meeting</label>
				<select class="control select" v-model="f.provider"><option v-for="p in config.providers" :key="p.key" :value="p.key">{{ p.label }}</option></select>
			</div>
			<div v-if="f.addVideo && f.provider === 'Manual Link'" style="margin-top:8px"><input class="control" type="url" v-model="f.link" placeholder="https://zoom.us/j/... or any meeting link" /></div>
			<div class="notice" v-if="f.addVideo && setupNotice"><ico name="alert" /><div>{{ setupNotice }} <a v-if="config.is_manager" :href="setupUrl" target="_blank" rel="noopener">Open setup</a></div></div>
			<div class="hint" v-else-if="f.addVideo && f.provider === 'Google Meet'">A Google Meet link is created and added to everyone's calendar.</div>
		</div>

		<div class="field"><label class="lbl">Description</label><textarea class="control" v-model="f.description" placeholder="Agenda, notes, dial-in details"></textarea></div>
		<div class="err" v-if="error">{{ error }}</div>
	</div>
	<div class="dialog-foot">
		<label class="check"><input type="checkbox" v-model="f.notify" /> {{ isNew ? 'Send invitations to guests' : 'Notify guests of this change' }}</label>
		<span class="spacer"></span>
		<button type="button" class="btn" @click="close">Cancel</button>
		<button type="submit" class="btn primary" :disabled="saving">{{ saving ? 'Saving…' : (isNew ? 'Schedule' : 'Save') }}</button>
	</div>
</form></div>`,
	}

	// ------------------------------------------------------------------ details drawer
	const Detail = {
		components: { Avatar, Ico },
		props: { meeting: Object },
		emits: ['edit', 'close', 'changed', 'toast'],
		setup(props, { emit }) {
			const busy = ref(false)
			const dialog = ref('') // '' | 'cancel' | 'notify'
			const notifyGuests = ref(true)
			const message = ref('')
			const byEmail = ref(true)
			const inApp = ref(true)
			const m = computed(() => props.meeting)
			const guests = computed(() => m.value.attendees || [])
			const responded = computed(() => guests.value.filter((g) => g.rsvp && g.rsvp !== 'Needs action').length)

			async function run(fn, done) {
				busy.value = true
				try { const r = await fn(); if (done) done(r) } catch (e) { emit('toast', e.message, 'err') } finally { busy.value = false }
			}
			const complete = () => run(() => call('crm_meetings.api.complete_meeting', { name: m.value.name }), (r) => { emit('changed', r); emit('toast', 'Marked as completed.') })
			const refresh = () => run(() => call('crm_meetings.api.refresh_meeting', { name: m.value.name }), (r) => { emit('changed', r); emit('toast', 'Guest responses updated.') })
			const cancel = () => run(() => call('crm_meetings.api.cancel_meeting', { name: m.value.name, notify: notifyGuests.value ? 'all' : 'none' }), (r) => { dialog.value = ''; emit('changed', r); emit('toast', 'Meeting cancelled.') })
			const notify = () => run(() => call('crm_meetings.api.notify_guests', { name: m.value.name, message: message.value, email: byEmail.value ? 1 : 0, in_app: inApp.value ? 1 : 0 }), (r) => { dialog.value = ''; message.value = ''; emit('toast', r.emailed ? `Notified ${r.emailed} guest${r.emailed > 1 ? 's' : ''} by email.` : 'Notification sent.') })
			const copy = async () => { try { await navigator.clipboard.writeText(m.value.google_meet_link); emit('toast', 'Meeting link copied.') } catch (e) { emit('toast', 'Could not copy the link.', 'err') } }
			const rsvpText = (r) => (r && r !== 'Needs action' ? r : 'No response yet')
			const openRecord = () => (window.parent !== window ? tellParent('navigate', { url: m.value.reference_url }) : (location.href = m.value.reference_url))
			const finished = computed(() => m.value.status !== 'Scheduled')
			return { busy, dialog, notifyGuests, message, byEmail, inApp, m, guests, responded, complete, refresh, cancel, notify, copy, rsvpText, openRecord, finished, whenText, statusClass }
		},
		template: `
<aside class="drawer">
	<div class="drawer-head"><h2>{{ m.subject }}</h2><button class="btn ghost icon" @click="$emit('close')" aria-label="Close"><ico name="x" size="lg" /></button></div>
	<div class="drawer-body">
		<div><span class="badge" :class="statusClass(m)">{{ m.status }}</span>
			<span class="badge warn" v-if="m.sync_status === 'Failed'" :title="m.sync_error">Sync failed</span>
			<span class="badge warn" v-else-if="m.sync_status === 'Not synced' && m.provider === 'Google Meet'" :title="m.sync_error">Not in Google Calendar</span></div>
		<div class="row"><ico name="clock" /><div>{{ whenText(m) }}</div></div>
		<div class="row" v-if="m.google_meet_link && m.status !== 'Cancelled'"><ico name="video" />
			<div style="min-width:0"><a class="join" :href="m.google_meet_link" target="_blank" rel="noopener" style="display:inline-flex"><ico name="video" /> Join {{ m.provider === 'Google Meet' ? 'with Google Meet' : 'meeting' }}</a>
			<div class="linkbox" style="margin-top:8px"><input :value="m.google_meet_link" readonly @focus="$event.target.select()" /><button class="btn ghost icon" @click="copy" title="Copy link">Copy</button></div></div></div>
		<div class="row" v-else-if="m.status === 'Scheduled'"><ico name="video" /><div class="sub">No video link on this meeting.</div></div>
		<div class="row"><ico name="contact" /><div><a href="#" @click.prevent="openRecord">{{ m.reference_title }}</a><div class="sub">{{ m.reference_doctype === 'CRM Deal' ? 'Deal' : 'Lead' }} · {{ m.reference_docname }}</div></div></div>
		<div class="row"><ico name="user" /><div>Organizer: <b>{{ m.organizer_name }}</b></div></div>
		<div class="row" v-if="m.description"><ico name="text" /><div style="white-space:pre-wrap">{{ m.description }}</div></div>
		<div v-if="m.sync_status === 'Failed' || (m.sync_status === 'Not synced' && m.provider === 'Google Meet')" class="banner" style="margin:0">{{ m.sync_error }}</div>
		<div>
			<div class="lbl" style="font-size:12px;font-weight:600;color:var(--text-soft);margin-bottom:4px">{{ guests.length }} guest{{ guests.length === 1 ? '' : 's' }} <span v-if="guests.length" style="font-weight:400">· {{ responded }} responded</span></div>
			<div class="guest" v-for="g in guests" :key="g.email"><avatar :name="g.full_name" :email="g.email" size="lg" /><div class="who"><div class="n">{{ g.full_name || g.email }}</div><div class="sub">{{ g.email }} · {{ rsvpText(g.rsvp) }}</div></div></div>
			<div class="sub" v-if="!guests.length">Nobody was invited.</div>
		</div>
		<div class="actions" v-if="m.can_edit || m.status !== 'Cancelled'">
			<button class="btn primary" v-if="m.can_edit && !finished" @click="$emit('edit', m)">Edit</button>
			<button class="btn" v-if="m.can_edit && !finished" @click="dialog = 'notify'">Notify guests</button>
			<button class="btn" v-if="m.can_edit && m.status === 'Scheduled'" @click="complete" :disabled="busy">Mark completed</button>
			<button class="btn" v-if="m.status !== 'Cancelled' && m.external_event_url" @click="refresh" :disabled="busy">Refresh responses</button>
			<button class="btn danger" v-if="m.can_edit && m.status === 'Scheduled'" @click="dialog = 'cancel'">Cancel meeting</button>
		</div>
	</div>

	<div class="overlay" v-if="dialog" @mousedown.self="dialog = ''">
		<div class="dialog small">
			<template v-if="dialog === 'cancel'">
				<div class="dialog-head"><h2>Cancel this meeting?</h2></div>
				<div class="dialog-body"><div>It will be removed from the calendar. This cannot be undone.</div>
					<label class="check"><input type="checkbox" v-model="notifyGuests" /> Tell the guests it was cancelled</label></div>
				<div class="dialog-foot"><span class="spacer"></span><button class="btn" @click="dialog = ''">Keep meeting</button><button class="btn danger" :disabled="busy" @click="cancel">Cancel meeting</button></div>
			</template>
			<template v-else>
				<div class="dialog-head"><h2>Notify guests</h2></div>
				<div class="dialog-body">
					<div class="field"><label class="lbl">Message (optional)</label><textarea v-model="message" placeholder="For example: Running 5 minutes late, joining now."></textarea></div>
					<label class="check"><input type="checkbox" v-model="byEmail" /> Send by email to all {{ guests.length }} guests</label>
					<label class="check"><input type="checkbox" v-model="inApp" /> Notify team members in the CRM</label>
				</div>
				<div class="dialog-foot"><span class="spacer"></span><button class="btn" @click="dialog = ''">Close</button><button class="btn primary" :disabled="busy || (!byEmail && !inApp)" @click="notify">Send</button></div>
			</template>
		</div>
	</div>
</aside>`,
	}

	// ------------------------------------------------------------------ app
	const App = {
		components: { Editor, Detail, Avatar, Avatars, Ico },
		setup() {
			const config = ref(null)
			const fatal = ref('')
			const view = ref(params.get('view') || 'agenda')
			const cursor = ref(sod(new Date()))
			const scope = ref('mine')
			const meetings = ref([])
			const loading = ref(false)
			const selected = ref(null)
			const editor = ref(null)
			const toasts = ref([])
			const stage = ref(null)
			const now = ref(new Date())
			const refName = params.get('reference_name') || ''
			const editorOnly = MODE === 'editor'

			function toast(text, kind) {
				const t = { id: Date.now() + Math.random(), text, kind }
				toasts.value.push(t)
				setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== t.id)), kind ? 6500 : 3200)
			}

			// range shown for the current view
			const range = computed(() => {
				const c = cursor.value
				if (view.value === 'month') { const s = startOfWeek(new Date(c.getFullYear(), c.getMonth(), 1)); return [s, addDays(s, 42)] }
				if (view.value === 'week') { const s = startOfWeek(c); return [s, addDays(s, 7)] }
				if (view.value === 'day') return [c, addDays(c, 1)]
				return [c, addDays(c, 45)]
			})
			const label = computed(() => {
				const c = cursor.value
				if (view.value === 'month') return c.toLocaleDateString([], { month: 'long', year: 'numeric' })
				if (view.value === 'day') return fmtDay(c)
				const [s, e] = range.value, last = addDays(e, -1)
				if (view.value === 'week') return `${s.toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${last.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`
				return sameDay(c, sod(new Date())) ? 'Upcoming' : `From ${fmtDay(c, { day: 'numeric', month: 'short', year: 'numeric' })}`
			})

			let seq = 0
			async function load(silent) {
				const my = ++seq
				if (!silent) loading.value = true
				try {
					const [s, e] = range.value
					const rows = await call('crm_meetings.api.list_meetings', {
						start: toSql(s), end: toSql(e), scope: scope.value, reference_name: refName || undefined,
					})
					if (my !== seq) return
					meetings.value = rows
					if (selected.value) { const fresh = rows.find((r) => r.name === selected.value.name); if (fresh) selected.value = fresh }
					fatal.value = ''
				} catch (err) { if (my === seq) fatal.value = err.message } finally { if (my === seq) loading.value = false }
			}
			watch([view, cursor, scope], () => load())

			function step(dir) {
				const c = cursor.value
				if (view.value === 'month') cursor.value = new Date(c.getFullYear(), c.getMonth() + dir, 1)
				else if (view.value === 'week') cursor.value = addDays(c, 7 * dir)
				else if (view.value === 'day') cursor.value = addDays(c, dir)
				else cursor.value = addDays(c, 30 * dir)
			}
			const today = () => (cursor.value = sod(new Date()))
			function go(d, v) { cursor.value = sod(d); view.value = v }
			const goHome = () => { view.value = 'agenda'; cursor.value = sod(new Date()); selected.value = null }
			const dateValue = computed(() => dateInput(cursor.value))
			function jump(e) { if (e.target.value) cursor.value = sod(new Date(e.target.value + 'T00:00:00')) }
			function openPicker(e) { try { e.target.showPicker() } catch (err) { /* older browsers open it on their own */ } }

			// ---------- agenda
			const agenda = computed(() => {
				const groups = new Map()
				for (const m of meetings.value) {
					const d = sod(fromSql(m.starts_on)), key = d.getTime()
					if (!groups.has(key)) groups.set(key, { date: d, items: [] })
					groups.get(key).items.push(m)
				}
				return [...groups.values()].sort((a, b) => a.date - b.date)
			})

			// ---------- month
			const monthCells = computed(() => {
				const [s] = range.value, out = []
				for (let i = 0; i < 42; i++) {
					const d = addDays(s, i)
					out.push({ date: d, dim: d.getMonth() !== cursor.value.getMonth(), today: sameDay(d, now.value), events: eventsOn(d) })
				}
				return out
			})
			function eventsOn(d) {
				const a = sod(d).getTime(), b = a + 86400000
				return meetings.value.filter((m) => fromSql(m.starts_on).getTime() < b && fromSql(m.ends_on).getTime() > a)
			}

			// ---------- week / day
			const days = computed(() => {
				const [s, e] = range.value, out = []
				for (let d = s; d < e; d = addDays(d, 1)) out.push(d)
				return out
			})
			function layout(d) {
				const a = sod(d).getTime(), b = a + 86400000
				const evs = eventsOn(d).map((m) => {
					const s = Math.max(fromSql(m.starts_on).getTime(), a), e = Math.min(fromSql(m.ends_on).getTime(), b)
					return { m, s, e, col: 0, cols: 1 }
				}).sort((x, y) => x.s - y.s || x.e - y.e)
				let cluster = [], clusterEnd = 0, ends = []
				const flush = () => { const n = Math.max(1, ...cluster.map((x) => x.col + 1)); cluster.forEach((x) => (x.cols = n)); cluster = []; ends = [] }
				for (const ev of evs) {
					if (cluster.length && ev.s >= clusterEnd) flush()
					let c = ends.findIndex((end) => end <= ev.s)
					if (c === -1) { c = ends.length; ends.push(ev.e) } else ends[c] = ev.e
					ev.col = c; cluster.push(ev); clusterEnd = Math.max(clusterEnd, ev.e)
				}
				flush()
				return evs.map((x) => ({
					m: x.m,
					style: {
						top: ((x.s - a) / 3600000) * HOUR + 'px',
						height: Math.max(22, ((x.e - x.s) / 3600000) * HOUR - 2) + 'px',
						left: `calc(${(x.col / x.cols) * 100}% + 2px)`,
						width: `calc(${100 / x.cols}% - 4px)`,
					},
				}))
			}
			const columns = computed(() => days.value.map((d) => ({ date: d, today: sameDay(d, now.value), events: layout(d) })))
			const nowTop = computed(() => ((now.value - sod(now.value)) / 3600000) * HOUR + 'px')
			function slotClick(e, d) {
				if (e.target.closest('.tev')) return
				const y = e.currentTarget.getBoundingClientRect(); const mins = Math.floor((e.clientY - y.top) / (HOUR / 2)) * 30
				const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, mins)
				newMeeting({ start: s })
			}
			watch([view, loading], async () => {
				if ((view.value === 'week' || view.value === 'day') && !loading.value) {
					await nextTick(); if (stage.value && !stage.value._scrolled) { stage.value.scrollTop = HOUR * 7.5; stage.value._scrolled = true }
				}
			})

			// ---------- actions
			const pickMeeting = (m) => (selected.value = m)
			function newMeeting(preset) {
				editor.value = { meeting: null, preset: { reference_doctype: params.get('reference_doctype') || 'CRM Lead', reference_docname: refName, reference_title: params.get('reference_title') || '', ...(preset || {}) } }
			}
			function editMeeting(m) { editor.value = { meeting: m, preset: null } }
			function onSaved(res) {
				const wasNew = !editor.value || !editor.value.meeting
				editor.value = null
				const mt = res.meeting
				const s = res.sync || {}
				if (s.status === 'Failed') toast('Saved, but Google Calendar sync failed: ' + s.error, 'warn')
				else if (s.status === 'Not synced' && mt.provider === 'Google Meet' && s.error) toast('Saved, but it is not in Google Calendar: ' + s.error, 'warn')
				else toast(wasNew ? 'Meeting scheduled.' : 'Meeting updated.')
				tellParent('saved', { meeting: mt })
				if (editorOnly) return tellParent('close')
				selected.value = mt
				load(true)
			}
			function onChanged(m) { selected.value = m; tellParent('saved', { meeting: m }); load(true) }
			function closeEditor() { editor.value = null; if (editorOnly) tellParent('close') }
			const closeSelf = () => tellParent('close')
			const openFull = () => window.open(location.pathname + (refName ? '?reference_name=' + encodeURIComponent(refName) : ''), '_blank')

			function onKey(e) {
				if (e.key !== 'Escape') return
				if (editor.value) return closeEditor()
				if (selected.value) return (selected.value = null)
				tellParent('close')
			}

			let timer, clock
			onMounted(async () => {
				document.addEventListener('keydown', onKey)
				try {
					config.value = await call('crm_meetings.api.get_client_config')
				} catch (err) { fatal.value = err.message; return }
				if (config.value.is_manager) scope.value = 'all'
				if (editorOnly) {
					const name = params.get('meeting')
					if (name) { try { editor.value = { meeting: await call('crm_meetings.api.get_meeting', { name }), preset: null } } catch (err) { fatal.value = err.message } }
					else newMeeting()
					return
				}
				// deep links: ?meeting=<id> jumps to that meeting's day and opens it; ?date=YYYY-MM-DD jumps to a day
				const open = params.get('meeting')
				let target = null
				if (open) {
					try { target = await call('crm_meetings.api.get_meeting', { name: open }); cursor.value = sod(fromSql(target.starts_on)) } catch (err) { toast(err.message, 'err') }
				} else if (params.get('date')) {
					const d = new Date(params.get('date') + 'T00:00:00')
					if (!isNaN(d)) cursor.value = sod(d)
				}
				await load()
				if (target) selected.value = meetings.value.find((x) => x.name === target.name) || target
				if (params.get('new') === '1') newMeeting()
				timer = setInterval(() => { if (!editor.value) load(true) }, 60000)
				clock = setInterval(() => (now.value = new Date()), 30000)
			})
			onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); clearInterval(timer); clearInterval(clock) })

			return {
				config, fatal, view, cursor, scope, meetings, loading, selected, editor, toasts, stage, label, agenda, monthCells, columns, days, nowTop,
				step, today, go, goHome, dateValue, jump, openPicker, pickMeeting, newMeeting, editMeeting, onSaved, onChanged, closeEditor, closeSelf, openFull, slotClick, toast, load, editorOnly,
				dowNames: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
				hours: Array.from({ length: 24 }, (_, h) => h), clockLabel, fmtTime, fmtDay, fromSql, whenText, shortRange, statusClass, sameDay, sod, EMBED, HOUR, refName,
			}
		},
		template: `
<div class="app" v-if="!editorOnly || editor">
	<template v-if="!editorOnly">
	<div class="toolbar" v-if="config">
		<button class="brand" @click="goHome" title="Upcoming meetings"><span class="brand-ico"><ico name="calendar-check" size="lg" /></span><h1>Meetings</h1></button>
		<div class="nav">
			<button class="btn" @click="today"><ico name="calendar" /> Today</button>
			<div class="navgroup"><button class="btn" @click="step(-1)" aria-label="Previous"><ico name="chevron-left" /></button><button class="btn" @click="step(1)" aria-label="Next"><ico name="chevron-right" /></button></div>
		</div>
		<label class="range-picker" title="Jump to a date"><span>{{ label }}</span><ico name="calendar" /><input type="date" :value="dateValue" @change="jump" @click="openPicker" aria-label="Jump to a date" /></label>
		<span class="spin" v-if="loading"></span>
		<span class="spacer"></span>
		<div class="seg" v-if="config.is_manager"><button :class="{ on: scope === 'mine' }" @click="scope = 'mine'">Mine</button><button :class="{ on: scope === 'all' }" @click="scope = 'all'">Everyone</button></div>
		<div class="seg"><button v-for="v in ['agenda','month','week','day']" :key="v" :class="{ on: view === v }" @click="view = v">{{ v[0].toUpperCase() + v.slice(1) }}</button></div>
		<button class="btn primary" @click="newMeeting()"><ico name="plus" /> Schedule</button>
		<button class="btn ghost icon" v-if="EMBED" @click="openFull" title="Open in a new tab" aria-label="Open in a new tab"><ico name="external" size="lg" /></button>
		<button class="btn ghost icon" v-if="EMBED" @click="closeSelf" title="Close (Esc)" aria-label="Close"><ico name="x" size="lg" /></button>
	</div>
	<div class="banner error" v-if="fatal">{{ fatal }}</div>
	<div class="main" v-if="config">
		<div class="stage" ref="stage">
			<!-- agenda -->
			<div v-if="view === 'agenda'" class="agenda">
				<div class="empty" v-if="!loading && !agenda.length"><div class="big"><ico name="calendar" /></div><h3>No meetings in this period</h3><div>Schedule one and it shows up here, on the Lead or Deal, and in Google Calendar.</div><p><button class="btn primary" @click="newMeeting()"><ico name="plus" /> Schedule a meeting</button></p></div>
				<div class="day-group" v-for="g in agenda" :key="g.date.getTime()">
					<div class="day-head" :class="{ today: sameDay(g.date, new Date()) }"><div class="dow">{{ g.date.toLocaleDateString([], { weekday: 'short' }) }}</div><div class="num">{{ g.date.getDate() }}</div><div class="mon">{{ g.date.toLocaleDateString([], { month: 'short' }) }}</div></div>
					<div class="cards">
						<div class="card" :class="statusClass(m)" v-for="m in g.items" :key="m.name" @click="pickMeeting(m)" tabindex="0" @keydown.enter="pickMeeting(m)">
							<div class="bar"></div>
							<div class="card-body">
								<div class="time">{{ shortRange(m) }} <span class="badge cancelled" v-if="m.status === 'Cancelled'">Cancelled</span><span class="badge completed" v-else-if="m.status === 'Completed'">Completed</span></div>
								<div class="title">{{ m.subject }}</div>
								<div class="meta"><span class="chip">{{ m.reference_doctype === 'CRM Deal' ? 'Deal' : 'Lead' }} · {{ m.reference_title }}</span><span v-if="scope === 'all'">by {{ m.organizer_name }}</span><span v-if="m.attendees.length">{{ m.attendees.length }} guest{{ m.attendees.length === 1 ? '' : 's' }}</span></div>
							</div>
							<div class="card-side"><avatars :guests="m.attendees" /><a v-if="m.google_meet_link && m.status === 'Scheduled'" class="join" :href="m.google_meet_link" target="_blank" rel="noopener" @click.stop><ico name="video" /> Join</a></div>
						</div>
					</div>
				</div>
			</div>

			<!-- month -->
			<div v-else-if="view === 'month'" class="month">
				<div class="dow-row"><div v-for="d in dowNames" :key="d">{{ d }}</div></div>
				<div class="month-grid">
					<div class="cell" v-for="c in monthCells" :key="c.date.getTime()" :class="{ dim: c.dim, today: c.today }" @click="go(c.date, 'day')">
						<div class="cell-num">{{ c.date.getDate() }}</div>
						<button class="ev" :class="statusClass(m)" v-for="m in c.events.slice(0, 3)" :key="m.name" @click.stop="pickMeeting(m)"><span class="t">{{ fmtTime(fromSql(m.starts_on)) }}</span> {{ m.subject }}</button>
						<div class="more-link" v-if="c.events.length > 3">+{{ c.events.length - 3 }} more</div>
					</div>
				</div>
			</div>

			<!-- week / day -->
			<div v-else class="tgrid">
				<div></div>
				<div class="tgrid-head" :style="{ gridTemplateColumns: 'repeat(' + days.length + ', 1fr)' }"><div class="h" :class="{ today: sameDay(d, new Date()) }" v-for="d in days" :key="d.getTime()" @click="go(d, 'day')"><div class="dow">{{ d.toLocaleDateString([], { weekday: 'short' }) }}</div><div class="num">{{ d.getDate() }}</div></div></div>
				<div class="hours"><div class="hour-label" v-for="h in hours" :key="h">{{ h === 0 ? '' : clockLabel(h) }}</div></div>
				<div class="cols" :style="{ gridTemplateColumns: 'repeat(' + days.length + ', 1fr)' }">
					<div class="col" v-for="c in columns" :key="c.date.getTime()" @click="slotClick($event, c.date)">
						<div class="hour-line" v-for="h in hours" :key="h"></div>
						<div class="now-line" v-if="c.today" :style="{ top: nowTop }"></div>
						<button class="tev" :class="statusClass(e.m)" v-for="e in c.events" :key="e.m.name" :style="e.style" @click.stop="pickMeeting(e.m)"><div class="tt">{{ e.m.subject }}</div><div>{{ fmtTime(fromSql(e.m.starts_on)) }}</div></button>
					</div>
				</div>
			</div>
		</div>
		<detail v-if="selected" :meeting="selected" @close="selected = null" @edit="editMeeting" @changed="onChanged" @toast="toast" />
	</div>
	<div class="empty" v-else-if="!fatal"><span class="spin"></span></div>
	</template>

	<editor v-if="editor && config" :meeting="editor.meeting" :preset="editor.preset" :config="config" :embedded="editorOnly" @saved="onSaved" @close="closeEditor" />
	<div class="toast-wrap"><div class="toast" :class="t.kind" v-for="t in toasts" :key="t.id">{{ t.text }}</div></div>
</div>
<div v-else class="empty"><div class="banner error" v-if="fatal" style="display:inline-block">{{ fatal }}</div><span class="spin" v-else></span></div>`,
	}

	createApp(App).mount('#app')
})()
