VARDION HEALTHCARE PORTAL V2 — CORRECTION LOCK + DEALER STOCK ORDER

Is update mein:
1) Chemist/Dealer profile edit API server-side locked hai. Admin correction unlock karega tabhi edit/resubmit hoga. UI bhi locked rehti hai.
2) Dealer Product catalogue se Company Stock Order bhej sakta hai.
3) Dealer stock order Admin ke Orders panel mein alag type ke roop mein dikhega aur Admin ko notification milegi.
4) Admin Receive stock par har product ka batch number aur future expiry date enter karega. Sirf successful receipt par inventory quantity add hogi; same order dobara receive nahi ho sakta.
5) Chemist purchase order flow alag rakha gaya hai; dealer stock order ke saath mix nahi hota.

IMPORTANT DATABASE STEP:
- prisma/schema.prisma mein OrderType add hua hai aur Order.chemistId optional hua hai. Existing PostgreSQL database par schema update zaroori hai.
- Safe backup pehle lein.
- Local/one-time trusted environment mein project folder se: npx prisma db push
- Required env: DATABASE_URL. Schema file ka directUrl abhi bhi DIRECT_URL maangta hai; Render par DIRECT_URL configured na ho to pehle schema.prisma mein directUrl line remove karein ya DIRECT_URL ko same DB URL set karein.
- Uske baad updated files GitHub par commit/push karke Render deploy hone dein.
- Do not delete/recreate the database.

Files: server.js, public/index.html, prisma/schema.prisma.
Testing performed locally: JavaScript syntax check only. Live Render, actual database migration, login, order receipt and notifications are NOT tested here. Run database backup before db push and test on a backup/staging database first if possible.


DISTRIBUTOR ROLE SAFETY NOTE:
New registrations, role changes and assignment UI/API no longer allow Distributor. Existing Distributor enum/legacy database columns are intentionally retained in Prisma schema so existing database data is not dropped. Do not remove those columns or enum from production without a separate reviewed migration and backup.

नए सुधार (Admin orders और stock visibility):
- Admin Orders स्क्रीन पर buyer का नाम, email, business name, phone, order number/date, product-wise quantity और line total दिखते हैं।
- Product catalogue में Chemist और Dealer सहित उपलब्ध कंपनी stock की quantity दिखाई जाती है; expired batches उपलब्ध quantity में शामिल नहीं हैं।
- Admin dashboard में Stock management tab से batches, expiry, quantity और expired/zero stock देख सकते हैं।
- ध्यान दें: अभी inventory company-level है; Dealer-wise अलग stock ledger इस build में नहीं जोड़ा गया है। Dealer stock को अलग-अलग track करने के लिए database schema/migration और stock issue workflow की आवश्यकता होगी।
- Profile correction flow में Admin का Allow correction action unlock करता है; user edit करके resubmit करता है और profile review में लौटती है।
- Production deploy से पहले backup लें। Build command में prisma db push database schema बदल सकता है; इसे backup/compatibility review के बिना न चलाएँ।
