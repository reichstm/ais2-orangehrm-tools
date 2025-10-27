require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const {Parser} = require('json2csv'); // npm install json2csv

const app = express();
app.use(bodyParser.urlencoded({extended: true}));

// --- Session ---
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

const contextRoot = process.env.CONTEXT_ROOT;

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

async function testConnection() {
    try {
        // Einen Pool-Connection abrufen
        const connection = await pool.getConnection();
        console.log('✅ MySQL Pool connected successfully');

        // Optional: Testabfrage
        const [rows] = await connection.query('SELECT 1 + 1 AS result');
        console.log('Test query result:', rows);

        connection.release(); // Verbindung zurück in den Pool
    } catch (err) {
        console.error('❌ MySQL Pool connection failed:', err.message);
    }
}

testConnection();

// --- Middleware ---
function ensureAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.redirect(contextRoot + "/login");
}

// GET /
app.get('/', ensureAuthenticated, async (req, res) => {
    const user = req.session.user;
    const root = contextRoot || '';
    const body = `
    <div class="bg-white p-6 rounded-lg shadow">
      <h2 class="text-xl font-semibold mb-4">Welcome ${user.name}</h2>
      <ul class="space-y-2">
        <li><a class="text-blue-600 hover:underline" href="${root}/attendances">View Attendances</a></li>
        <li><a class="text-blue-600 hover:underline" href="${root}/timesheet">View Time Sheet</a></li>
        <li><a class="text-blue-600 hover:underline" href="${root}/attendance-diff">Show Differences between Attendance and Time Sheets</a></li>
        <li><a class="text-blue-600 hover:underline" href="${root}/leave-calendar">Show Leave Calendar</a></li>
        <li><a class="text-red-600 hover:underline" href="${root}/logout">Logout</a></li>
      </ul>
    </div>
  `;
    res.send(renderPage('Home', body));
});

// --- Login Form ---
app.get('/login', (req, res) => {
    res.send(`
    <h2>Login</h2>
    <form method="post" action="${contextRoot}/login">
      <input type="text" name="email" placeholder="Email" required /><br/>
      <input type="password" name="password" placeholder="Password" required /><br/>
      <button type="submit">Login</button>
    </form>
  `);
});

// --- Login Handler ---
app.post('/login', async (req, res) => {
    const {email, password} = req.body;
    console.log('Try to login ' + email);

    try {
        // OrangeHRM: Password usually hashed, example assumes plaintext (for demo)
        const [rows] = await pool.query(
            'SELECT * FROM orangehrm.ohrm_user WHERE user_name = ?',
            [email]
        );

        if (rows.length === 0) {
            return res.send('Invalid credentials');
        }

        const user = rows[0];
        const bcrypt = require('bcryptjs');
        if (!bcrypt.compareSync(password, user.user_password)) return res.send('Invalid credentials');

        req.session.user = {id: user.emp_number, name: user.user_name};
        res.redirect(contextRoot + '/');
    } catch (err) {
        console.error(err);
        res.send('Login error');
    }
});

// --- Logout ---
app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect(contextRoot + '/login'));
});

app.get('/timesheet/csv', ensureAuthenticated, async (req, res) => {
    const {from, to} = req.query;
    const username = req.session.user.name;

    if (!from || !to) return res.send('Please provide both dates.');

    try {
        const [rows] = await pool.query(
            `SELECT e.user_name,
                    tr.date,
                    tr.duration / 60 / 60 AS hours,
                    p.name AS project_name,
                    a.name                AS activity_name,
                    tr.comment
             FROM ohrm_timesheet_item tr
                      JOIN ohrm_user e ON tr.employee_id = e.emp_number
                      JOIN ohrm_project p ON tr.project_id = p.project_id
                      JOIN ohrm_project_activity a ON tr.activity_id = a.activity_id
             WHERE e.user_name = ?
               AND tr.date >= ?
               AND tr.date <= ?
             ORDER BY e.emp_number, tr.date;`,
            [username, from, to]
        );

        if (rows.length === 0) return res.send('No time entries found.');

        // Convert to CSV
        const parser = new Parser();
        const csv = parser.parse(rows);

        res.header('Content-Type', 'text/csv');
        res.attachment(`timesheet_${from}_to_${to}.csv`);
        res.send(csv);

    } catch (err) {
        console.error(err);
        res.status(500).send('Database error');
    }
});

// Add near the top of `index.js` (after app and middleware setup)
function renderPage(title, body, extraHead = '') {
    const root = contextRoot || '';
    return `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>${title}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      ${extraHead}
    </head>
    <body class="bg-gray-50 text-gray-800">
      <header class="bg-white shadow">
        <div class="container mx-auto px-6 py-4 flex items-center justify-between">
          <h1 class="text-xl font-semibold">${title}</h1>
          <nav class="space-x-4 text-sm">
            <a class="text-blue-600 hover:underline" href="${root}/">Home</a>
            <a class="text-blue-600 hover:underline" href="${root}/leave-calendar">Leave Calendar</a>
            <a class="text-red-600 hover:underline" href="${root}/logout">Logout</a>
          </nav>
        </div>
      </header>
      <main class="container mx-auto px-6 py-8">
        ${body}
      </main>
    </body>
  </html>
  `;
}

// Replace/modify these route handlers in `index.js` to use the wrapper:

// GET /login
app.get('/login', (req, res) => {
    const root = contextRoot || '';
    const body = `
    <div class="max-w-md mx-auto bg-white p-6 rounded-lg shadow">
      <h2 class="text-2xl font-medium mb-4">Login</h2>
      <form method="post" action="${root}/login" class="space-y-4">
        <input class="w-full border rounded px-3 py-2" type="text" name="email" placeholder="Email" required />
        <input class="w-full border rounded px-3 py-2" type="password" name="password" placeholder="Password" required />
        <div class="flex justify-end">
          <button class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700" type="submit">Login</button>
        </div>
      </form>
    </div>
  `;
    res.send(renderPage('Login', body, '<style>body{background:#f3f4f6}</style>'));
});

// GET /timesheet (form)
app.get('/timesheet', ensureAuthenticated, (req, res) => {
    const root = contextRoot || '';
    const today = new Date();
    const firstDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().split("T")[0];
    const lastDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).toISOString().split("T")[0];

    const body = `
    <div class="max-w-lg mx-auto bg-white p-6 rounded shadow">
      <h2 class="text-xl font-medium mb-4">Show Time Sheet</h2>
      <form method="post" action="${root}/timesheet" class="space-y-4">
        <label class="block">From: <input class="mt-1 border rounded px-2 py-1" type="date" name="from" value="${firstDay}"></label>
        <label class="block">To: <input class="mt-1 border rounded px-2 py-1" type="date" name="to" value="${lastDay}"></label>
        <div class="flex justify-end">
          <button class="bg-blue-600 text-white px-4 py-2 rounded" type="submit">Show</button>
        </div>
      </form>
    </div>
  `;
    res.send(renderPage('Time Sheet', body));
});

// POST /timesheet (results) - replace the HTML rendering part with Tailwind table
app.post('/timesheet', ensureAuthenticated, async (req, res) => {
    let {from, to} = req.body;
    const username = req.session.user.name;
    if (!from) from = '0001-01-01';
    if (!to) to = '9999-12-31';

    try {
        const [rows] = await pool.query(
            // same query as before
            `SELECT e.user_name,
                    tr.date,
                    tr.duration / 60 / 60 AS hours,
                    p.name AS project_name,
                    a.name                AS activity_name,
                    tr.comment
             FROM ohrm_timesheet_item tr
                      JOIN ohrm_user e ON tr.employee_id = e.emp_number
                      JOIN ohrm_project p ON tr.project_id = p.project_id
                      JOIN ohrm_project_activity a ON tr.activity_id = a.activity_id
             WHERE e.user_name = ?
               AND tr.date >= ?
               AND tr.date <= ?
             ORDER BY e.emp_number, tr.date;`,
            [username, from, to]
        );

        if (rows.length === 0) return res.send(renderPage('Time Sheet', '<div class="bg-white p-6 rounded shadow">Keine Zeiteinträge gefunden.</div>'));

        const totalHours = rows.reduce((sum, r) => sum + Number(r.hours || 0), 0);

        let tableRows = rows.map(r => {
            const hours = Number(r.hours);
            const date = r.date.toISOString().split('T')[0];
            return `
        <tr class="bg-white">
          <td class="px-4 py-2 border">${r.user_name}</td>
          <td class="px-4 py-2 border">${date}</td>
          <td class="px-4 py-2 border text-right">${hours.toFixed(2)}</td>
          <td class="px-4 py-2 border">${r.project_name}</td>
          <td class="px-4 py-2 border">${r.activity_name}</td>
          <td class="px-4 py-2 border">${r.comment || ''}</td>
        </tr>`;
        }).join('');

        const root = contextRoot || '';
        const body = `
      <div class="bg-white p-6 rounded shadow">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold">Time Sheet</h2>
          <div class="text-sm text-gray-600">Total hours: <strong>${totalHours.toFixed(2)}</strong></div>
        </div>
        <div class="mb-4">
          <a class="inline-block bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700" href="${root}/timesheet/csv?from=${from}&to=${to}">Download CSV</a>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full border-collapse">
            <thead class="bg-gray-100">
              <tr>
                <th class="px-4 py-2 border text-left">User</th>
                <th class="px-4 py-2 border text-left">Date</th>
                <th class="px-4 py-2 border text-right">Hours</th>
                <th class="px-4 py-2 border text-left">Project</th>
                <th class="px-4 py-2 border text-left">Activity</th>
                <th class="px-4 py-2 border text-left">Comment</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
        <div class="mt-4">
          <a class="text-blue-600 hover:underline" href="${root}/">Back</a>
        </div>
      </div>
    `;
        res.send(renderPage('Time Sheet', body));
    } catch (err) {
        console.error(err);
        res.status(500).send(renderPage('Error', '<div class="bg-white p-6 rounded shadow">Datenbankfehler</div>'));
    }
});

// GET /leave-calendar - include FullCalendar script but still use the Tailwind wrapper
app.get('/leave-calendar', ensureAuthenticated, async (req, res) => {
    try {
        const [rows] = await pool.query(
            // same query as before
            `SELECT DISTINCT CONCAT(e.emp_firstname, ' ', e.emp_lastname) AS employee_name,
                             ls.name                                      AS leave_status,
                             lt.name                                      AS leave_type,
                             l.date                                       AS start_date,
                             l.date + INTERVAL (l.length_days - 1) DAY AS end_date
             FROM ohrm_leave l
                 JOIN hs_hr_employee e
             ON l.emp_number = e.emp_number
                 JOIN ohrm_user u ON l.emp_number = e.emp_number
                 JOIN ohrm_leave_status ls ON l.status = ls.status
                 JOIN ohrm_leave_type lt ON l.leave_type_id = lt.id
             WHERE l.date >= CURRENT_DATE - 7`
        );

        const colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];
        const employeeMap = {};
        let colorIndex = 0;

        const events = rows.map(r => {
            if (!employeeMap[r.employee_name]) {
                employeeMap[r.employee_name] = colors[colorIndex % colors.length];
                colorIndex++;
            }
            const color = employeeMap[r.employee_name];
            return {
                title: `${r.employee_name} - ${r.leave_type}`,
                start: r.start_date,
                end: new Date(new Date(r.end_date).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                color: color,
                allDay: true
            };
        });

        const extraHead = `<script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.19/index.global.min.js"></script>`;
        const body = `
      <div class="bg-white p-4 rounded shadow">
        <div id="calendar" class="mt-4"></div>
      </div>
      <script>
        document.addEventListener('DOMContentLoaded', function() {
          var calendarEl = document.getElementById('calendar');
          var calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            events: ${JSON.stringify(events)},
            firstDay: 1,
            height: 'auto',
            headerToolbar: {
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek,timeGridDay'
            }
          });
          calendar.render();
        });
      </script>
    `;

        res.send(renderPage('Leave Calendar', body, extraHead));
    } catch (err) {
        console.error(err);
        res.status(500).send(renderPage('Error', '<div class="bg-white p-6 rounded shadow">Database error</div>'));
    }
});

// GET /attendance-diff - styled table
app.get('/attendance-diff', ensureAuthenticated, async (req, res) => {
    const username = req.session.user.name;

    try {
        const [rows] = await pool.query(
            // same query as before
            `SELECT DATE (ar.punch_in_utc_time) AS date, SUM(TIMESTAMPDIFF(SECOND, ar.punch_in_utc_time, ar.punch_out_utc_time)) / 3600 AS attended, COALESCE (MAX(tr_sum.duration), 0) / 3600 AS booked, (SUM(TIMESTAMPDIFF(SECOND, ar.punch_in_utc_time, ar.punch_out_utc_time)) - COALESCE (MAX(tr_sum.duration), 0)) / 3600 AS difference
             FROM orangehrm.ohrm_attendance_record ar
                 JOIN orangehrm.ohrm_user u
             ON ar.employee_id = u.emp_number
                 JOIN hs_hr_employee e ON u.emp_number = e.emp_number
                 LEFT JOIN (
                 SELECT employee_id, date, SUM(duration) AS duration
                 FROM orangehrm.ohrm_timesheet_item
                 GROUP BY employee_id, date
                 ) tr_sum ON e.emp_number = tr_sum.employee_id
                 AND DATE (ar.punch_in_utc_time) = tr_sum.date
             WHERE u.user_name = ?
             GROUP BY DATE (ar.punch_in_utc_time)
             HAVING (SUM(TIMESTAMPDIFF(SECOND
                  , ar.punch_in_utc_time
                  , ar.punch_out_utc_time)) - COALESCE (MAX(tr_sum.duration)
                  , 0)) / 3600 != 0
             ORDER BY DATE (ar.punch_in_utc_time);`,
            [username]
        );

        if (rows.length === 0) return res.send(renderPage('Attendance Diff', '<div class="bg-white p-6 rounded shadow">Keine Differenzen gefunden.</div>'));

        const tableRows = rows.map(r => {
            const date = r.date.toISOString().split('T')[0];
            return `
        <tr class="bg-white">
          <td class="px-4 py-2 border">${date}</td>
          <td class="px-4 py-2 border text-right">${Number(r.attended).toFixed(2)}</td>
          <td class="px-4 py-2 border text-right">${Number(r.booked).toFixed(2)}</td>
          <td class="px-4 py-2 border text-right">${Number(r.difference).toFixed(2)}</td>
        </tr>`;
        }).join('');

        const root = contextRoot || '';
        const body = `
      <div class="bg-white p-6 rounded shadow">
        <h2 class="text-lg font-semibold mb-4">Attended vs Booked Time</h2>
        <div class="overflow-x-auto">
          <table class="min-w-full border-collapse">
            <thead class="bg-gray-100">
              <tr>
                <th class="px-4 py-2 border text-left">Date</th>
                <th class="px-4 py-2 border text-right">Attended (h)</th>
                <th class="px-4 py-2 border text-right">Booked (h)</th>
                <th class="px-4 py-2 border text-right">Difference (h)</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
        <div class="mt-4">
          <a class="text-blue-600 hover:underline" href="${root}/">Back</a>
        </div>
      </div>
    `;
        res.send(renderPage('Attendance Diff', body));
    } catch (err) {
        console.error(err);
        res.status(500).send(renderPage('Error', '<div class="bg-white p-6 rounded shadow">Database error</div>'));
    }
});

app.get('/attendances', ensureAuthenticated, (req, res) => {
    const root = contextRoot || '';
    const today = new Date();
    const firstDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().split("T")[0];
    const lastDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).toISOString().split("T")[0];

    const body = `
    <div class="max-w-lg mx-auto bg-white p-6 rounded shadow">
      <h2 class="text-xl font-medium mb-4">Show Attendances</h2>
      <form method="post" action="${root}/attendances" class="space-y-4">
        <label class="block">From: <input class="mt-1 border rounded px-2 py-1" type="date" name="from" value="${firstDay}"></label>
        <label class="block">To: <input class="mt-1 border rounded px-2 py-1" type="date" name="to" value="${lastDay}"></label>
        <div class="flex justify-end">
          <button class="bg-blue-600 text-white px-4 py-2 rounded" type="submit">Show</button>
        </div>
      </form>
    </div>
  `;
    res.send(renderPage('Time Sheet', body));
});

app.post('/attendances', ensureAuthenticated, async (req, res) => {
    const username = req.session.user.name;
    const { from, to } = req.body;

    // Default date range if none provided
    const fromDate = from && from.trim() !== '' ? from : '0001-01-01';
    const toDate = to && to.trim() !== '' ? to : '9999-12-31';

    try {
        const [rows] = await pool.query(
            `SELECT ar.punch_in_utc_time                                                   AS punch_in,
                    ar.punch_out_utc_time                                                  AS punch_out,
                    TIMEDIFF(ar.punch_out_utc_time, ar.punch_in_utc_time)                  AS duration,
                    TIMESTAMPDIFF(MINUTE, ar.punch_in_utc_time, ar.punch_out_utc_time) / 60       AS attended_hours,
                    SUM(TIMESTAMPDIFF(SECOND, ar.punch_in_utc_time, ar.punch_out_utc_time))
                        OVER (PARTITION BY WEEK(ar.punch_in_utc_time, 1)) / 60 / 60        AS hours_per_week,
                    SUM(TIMESTAMPDIFF(SECOND, ar.punch_in_utc_time, ar.punch_out_utc_time))
                        OVER (PARTITION BY WEEK(ar.punch_in_utc_time, 1)) / 60 / 60 - 38.5 AS difference_per_week
             FROM orangehrm.ohrm_attendance_record ar
                      JOIN orangehrm.ohrm_user u ON ar.employee_id = u.emp_number
             WHERE u.user_name = ?
               AND ar.punch_in_utc_time >= ?
               AND ar.punch_in_utc_time <= ?
             ORDER BY u.emp_number, ar.punch_in_utc_time`,
            [username, fromDate, toDate]
        );

        if (!rows.length) {
            return res.send(`
        <h2>No attendance records found for ${username}</h2>
        <a href="${contextRoot}">Back</a>
      `);
        }

        let sumAttendedHours = 0;
        let attendedDatesSet = new Set();

        let tableRows = rows.map(r => {
            const punchIn = r.punch_in ? new Date(r.punch_in).toLocaleString(): r.punch_in;
            const punchOut = r.punch_out ? new Date(r.punch_out).toLocaleString(): r.punch_out;
            const hoursPerWeek = r.hours_per_week && Number(r.hours_per_week) ? Number(r.hours_per_week).toFixed(2) : '0.00';
            const differencePerWeek = r.difference_per_week && Number(r.difference_per_week) ? Number(r.difference_per_week).toFixed(2) : '0.00';
            const attendedHours = r.attended_hours && Number(r.attended_hours) ? Number(r.attended_hours) : 0;
            sumAttendedHours += attendedHours;
            attendedDatesSet.add(punchIn.split(' ')[0]); // Collect unique dates
            return `
        <tr class="bg-white">
          <td class="px-4 py-2 border">${punchIn}</td>
          <td class="px-4 py-2 border">${punchOut}</td>
          <td class="px-4 py-2 border text-right">${r.duration}</td>
          <td class="px-4 py-2 border text-right">${hoursPerWeek}</td>
          <td class="px-4 py-2 border text-right">${differencePerWeek}</td>
        </tr>`;
        }).join('');

        const root = contextRoot || '';
        const body = `
      <div class="bg-white p-6 rounded shadow">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold">Attendances</h2>
          <div class="text-sm text-gray-600">
            Total attended: <strong>${sumAttendedHours.toFixed(2)}h</strong>
            &nbsp; Planned: <strong>${(attendedDatesSet.size * 7.7).toFixed(2)}h</strong>
            &nbsp; Difference: <strong>${(sumAttendedHours - (attendedDatesSet.size * 7.7)).toFixed(2)}h</strong>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full border-collapse">
            <thead class="bg-gray-100">
              <tr>
                <th class="px-4 py-2 border text-left">Punch In</th>
                <th class="px-4 py-2 border text-left">Punch Out</th>
                <th class="px-4 py-2 border text-right">Hours</th>
                <th class="px-4 py-2 border text-left">Weekly Hours</th>
                <th class="px-4 py-2 border text-left">Difference to 38.5h</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
        <div class="mt-4">
          <a class="text-blue-600 hover:underline" href="${root}/">Back</a>
        </div>
      </div>
    `;
        res.send(renderPage('Attendances', body));
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error');
    }
});

app.get('/leave-calendar.ics', async (req, res) => {
    try {
        // ✅ Check for API key in query or header
        const apiKey = req.query.apiKey || req.headers['x-api-key'];
        if (apiKey !== process.env.CALENDAR_API_KEY) {
            return res.status(401).send('Unauthorized');
        }

        const [rows] = await pool.query(`
      SELECT DISTINCT
             CONCAT(e.emp_firstname, ' ', e.emp_lastname) AS employee_name,
             ls.name AS leave_status,
             lt.name AS leave_type,
             l.date AS start_date,
             l.date + INTERVAL (l.length_days - 1) DAY AS end_date
      FROM orangehrm.ohrm_leave l
               JOIN hs_hr_employee e ON l.emp_number = e.emp_number
               JOIN ohrm_user u ON l.emp_number = e.emp_number
               JOIN ohrm_leave_status ls ON l.status = ls.status
               JOIN ohrm_leave_type lt ON l.leave_type_id = lt.id
      WHERE l.date >= CURRENT_DATE - 7
      ORDER BY l.date;
    `);

        // ✅ Build iCalendar feed
        let ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OrangeHRM//AIS2//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
`;

        rows.forEach(r => {
            const start = r.start_date.toISOString().split('T')[0].replace(/-/g, '');
            const end = new Date(r.end_date);
            end.setDate(end.getDate() + 1);
            const endStr = end.toISOString().split('T')[0].replace(/-/g, '');

            const title = `${r.employee_name} - ${r.leave_type}`;
            const description = `Leave type: ${r.leave_type}\nStatus: ${r.leave_status}\nRecorded in OrangeHRM.`;

            ics += `BEGIN:VEVENT
UID:${r.employee_name}-${start}@ais2
SUMMARY:${title}
DESCRIPTION:${description}
CATEGORIES:${r.leave_type}
STATUS:CONFIRMED
TRANSP:TRANSPARENT
CLASS:PUBLIC
DTSTART;VALUE=DATE:${start}
DTEND;VALUE=DATE:${endStr}
END:VEVENT
`;
        });

        ics += 'END:VCALENDAR';

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'inline; filename="leave-calendar.ics"');
        res.send(ics);

    } catch (err) {
        console.error(err);
        res.status(500).send('Error generating calendar');
    }
});


// --- Start server ---
app.listen(3000, () => console.log('Server running on port 3000'));

