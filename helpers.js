function nowInManila() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(new Date());
    const get = type => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function manilaTimeFromDate(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(date);
    const get = type => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function isoDayOfWeek(dateTimeStr) {
    const datePart = dateTimeStr.slice(0, 10);
    const d = new Date(datePart + 'T00:00:00');
    const day = d.getDay();
    return day === 0 ? 7 : day;
}

function to12h(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function generateVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isInstitutionalEmail(email) {
    return /^[^\s@]+@mabinicolleges\.edu\.ph$/i.test(email);
}

async function sendEmail(to, subject, message) {
    try {
        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
                "api-key": process.env.BREVO_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                sender: { name: "Classroom Reservation System", email: "luwiserrano@gmail.com" },
                to: [{ email: to }],
                subject,
                textContent: message
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("EMAIL SEND ERROR:", response.status, errorBody);
            return;
        }

        console.log("EMAIL SENT to", to);
    } catch (err) {
        console.error("EMAIL SEND ERROR:", err);
    }
}

module.exports = {
    nowInManila,
    manilaTimeFromDate,
    isoDayOfWeek,
    to12h,
    generateVerificationCode,
    isValidEmail,
    isInstitutionalEmail,
    sendEmail
};