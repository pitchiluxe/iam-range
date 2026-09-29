# Lab 12 — Identity Governance Dashboard

**Days 78–84 · Phase 3: Lifecycle & Governance · Repo:** `iam-access-governance` (folder `dashboard/`)

## Do this lab in the app

1. **Terminal**: pull your in-app evidence — `Get-PimAssignment`,
   `Export-IamAuditLog -Last 200` — and keep it in **Sheets** for the KPI doc.
2. **PowerShell (this PC)**: make 12 more tickets with Lab 11's module so the
   charts have shape, then build the data folder. The grants file is derived
   from fulfilled tickets:

```powershell
# PowerShell (this PC)
cd $HOME\Documents\c90
Import-Module .\ticketing\C90.Tickets.psm1 -Force
New-Item -ItemType Directory -Force .\dashboard\data | Out-Null
Copy-Item .\ticketing\data\tickets.json .\dashboard\data\
Get-C90Tickets | Where-Object { $_.State -in 'Fulfilled','Closed' } | ForEach-Object {
    $granted = [datetime](($_.History | Where-Object State -eq 'Fulfilled').At)
    [pscustomobject]@{ Id = $_.Id; User = $_.Requester; Group = $_.Group
        GrantedAt = $granted.ToString('o'); ExpiresAt = $granted.AddHours([double]$_.Hours).ToString('o')
        Status = if ($_.State -eq 'Closed') { 'Expired' } else { 'Active' } }
} | Export-Csv .\dashboard\data\jit-grants.csv -NoTypeInformation
```

3. Save `index.html` (below) into `Documents\c90\dashboard\` with **Notepad**.
4. **PowerShell (this PC)**: serve it and open it. The in-app Browser only
   loads `https` sites on its allowlist, so the dashboard opens in your normal
   browser:

```powershell
# PowerShell (this PC)
cd $HOME\Documents\c90\dashboard
Start-Process 'http://localhost:8000'
python -m http.server 8000
```

   The server keeps running; click **Stop** in the console when you're done.
   No Python? `winget install Python.Python.3.12` in the same console.

## Career objective

Turn the data your automation already produces (tickets, JIT grants, review
decisions, JML logs) into the KPIs an IAM manager reports upward — and be able
to defend how each number is calculated.

## Quick review

1. Which three IAM KPIs would a CISO ask for first?
2. Why is "number of access requests" a weak metric on its own?
3. What does an *overdue* JIT grant indicate about your controls?
4. Why must a public portfolio dashboard use synthetic data only?
5. Why does `fetch()` fail when you double-click an HTML file?

## Scenario

Leadership asks every Monday: how many requests are waiting, are we meeting
approval SLA, is any temporary access overdue for removal, and what's most
requested? Build a page that answers all four from your lab data.

## Concept — KPIs and their formulas

| KPI | Formula | Good looks like |
|---|---|---|
| Open requests | tickets in `PendingApproval` or `Approved` | Low and stable |
| Approval SLA met | % of approved tickets decided within 8 h | ≥ 95% |
| Overdue JIT | grants `Active` with `ExpiresAt` in the past | **0** — anything else is a control failure |
| Top resources | tickets grouped by `Group` | Candidates for role-based access |

## Hands-on lab

### Data

```powershell
New-Item -ItemType Directory -Force .\dashboard\data | Out-Null
Copy-Item .\ticketing\data\tickets.json .\dashboard\data\
Copy-Item C:\C90\jit-grants.csv .\dashboard\data\
```

Create 10–15 more tickets with Lab 11's module first so the charts have shape.

### `dashboard/index.html`

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IAM Governance</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js"></script>
<style>
  body{margin:0;font:14px system-ui,sans-serif;background:#f6f7f9;color:#1f2933}
  header{padding:16px 20px;background:#1f2933;color:#fff}
  main{max-width:1100px;margin:0 auto;padding:16px;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
  .card{background:#fff;border-radius:8px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .kpi{font-size:32px;font-weight:700}.bad{color:#c62828}
  table{width:100%;border-collapse:collapse}td,th{padding:4px 6px;border-bottom:1px solid #eee;text-align:left}
</style>
</head>
<body>
<header><strong>IAM Governance Dashboard</strong> · synthetic lab data</header>
<main>
  <div class="card"><div>Open requests</div><div class="kpi" id="open">–</div></div>
  <div class="card"><div>Approval SLA met (8 h)</div><div class="kpi" id="sla">–</div></div>
  <div class="card"><div>Overdue JIT grants</div><div class="kpi" id="overdue">–</div></div>
  <div class="card"><canvas id="states"></canvas></div>
  <div class="card"><canvas id="resources"></canvas></div>
  <div class="card" style="grid-column:1/-1"><table><thead><tr>
    <th>Ticket</th><th>Requester</th><th>Group</th><th>State</th><th>Age (h)</th></tr></thead>
    <tbody id="rows"></tbody></table></div>
</main>
<script>
const hours = (a, b) => (b - a) / 36e5;
const at = (t, s) => { const h = t.History.filter(x => x.State === s).pop(); return h ? new Date(h.At) : null; };

async function load() {
  const tickets = await (await fetch('data/tickets.json')).json();
  const grants = Papa.parse(await (await fetch('data/jit-grants.csv')).text(),
                            { header: true, skipEmptyLines: true }).data;
  const now = new Date();

  const open = tickets.filter(t => ['PendingApproval', 'Approved'].includes(t.State));
  document.getElementById('open').textContent = open.length;

  const decided = tickets.filter(t => at(t, 'Approved') || at(t, 'Denied'));
  const inSla = decided.filter(t => hours(at(t, 'PendingApproval'), at(t, 'Approved') || at(t, 'Denied')) <= 8);
  document.getElementById('sla').textContent =
    decided.length ? Math.round(100 * inSla.length / decided.length) + '%' : 'n/a';

  const overdue = grants.filter(g => g.Status === 'Active' && new Date(g.ExpiresAt) < now).length;
  const el = document.getElementById('overdue');
  el.textContent = overdue; el.classList.toggle('bad', overdue > 0);

  const count = (arr, key) => arr.reduce((m, x) => (m[x[key]] = (m[x[key]] || 0) + 1, m), {});
  const states = count(tickets, 'State');
  new Chart(document.getElementById('states'), { type: 'doughnut',
    data: { labels: Object.keys(states), datasets: [{ data: Object.values(states) }] },
    options: { plugins: { title: { display: true, text: 'Tickets by state' } } } });

  const top = Object.entries(count(tickets, 'Group')).sort((a, b) => b[1] - a[1]).slice(0, 8);
  new Chart(document.getElementById('resources'), { type: 'bar',
    data: { labels: top.map(x => x[0]), datasets: [{ label: 'Requests', data: top.map(x => x[1]) }] },
    options: { indexAxis: 'y', plugins: { title: { display: true, text: 'Most requested' } } } });  // v4: no 'horizontalBar'

  const tbody = document.getElementById('rows');
  for (const t of open) {
    const tr = tbody.insertRow();
    const since = at(t, t.State);
    for (const v of [t.Id, t.Requester, t.Group, t.State, since ? hours(since, now).toFixed(1) : '']) {
      tr.insertCell().textContent = v;   // textContent: ticket text is user input, never innerHTML
    }
  }
}
load().catch(e => document.querySelector('main').insertAdjacentText('afterbegin', 'Load failed: ' + e.message));
</script>
</body>
</html>
```

### Pin the CDN scripts (Subresource Integrity)

A compromised CDN could serve different JavaScript. On cdnjs.com, open each
library version, click **Copy SRI**, and add the result to its tag:
`<script src="…chart.umd.min.js" integrity="sha512-…" crossorigin="anonymous"></script>`.
The browser then refuses any file whose hash doesn't match.

### Run it

`fetch()` is blocked on `file://`, so serve the folder:

```powershell
cd .\dashboard
python -m http.server 8000      # then open http://localhost:8000
```

### Publish (optional)

GitHub Pages works for this static folder — but only with synthetic data.
Regenerate `data/` with made-up names before you push; never publish real
tickets or grants.

## Validation checklist

- Page loads from `http://localhost:8000` with no console errors
- Both CDN `<script>` tags carry `integrity` + `crossorigin` attributes
- All three KPI tiles show numbers you can recompute by hand from the files
- Overdue JIT turns red when you stop the `C90-JIT-Revoke` task and let a grant pass expiry
- The table escapes ticket text (put `<b>x</b>` in a justification and confirm it shows literally)
- A one-page `docs/lab12-kpis.md` defines each KPI's formula

## Challenge

Add a date-range filter (two `<input type="date">`) that recomputes every KPI
for the chosen window, and a *Print / Save as PDF* button (`window.print()` with
a print stylesheet). Which KPI changes meaning when you filter by date?

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Failed to fetch` | Opened via `file://` — use the local server |
| Charts empty, no error | JSON is a single object, not an array — see Lab 11's PS 5.1 note |
| Dates show `Invalid Date` | CSV opened and resaved in Excel — keep ISO 8601 |
| Chart type error | Chart.js v2 syntax (`horizontalBar`) on v4 |

## GitHub assignment

`dashboard/` with `index.html`, synthetic `data/`, a screenshot, and the KPI doc.

## Resume bullet

> Built an identity-governance dashboard (Chart.js) reporting open requests,
> approval-SLA compliance, overdue just-in-time grants and most-requested
> resources from automated ticketing and JIT data.

## Interview question

"What metrics would you report to show an IAM program is working?" Pick three,
give the formula for each, and say what you'd do when one goes red.

## Homework

- Add review completion % from Lab 10's `-applied.csv` files.
- Read about Entra ID *Access reviews* reporting and compare its metrics with yours.
