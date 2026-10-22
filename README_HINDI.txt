VARDION HEALTHCARE PORTAL — FULL-STACK STARTER
================================================

यह पहले वाली demo ZIP से ज्यादा पूर्ण backend starter है। इसमें API और PostgreSQL/Prisma schema के आधार पर:
- CHEMIST / DEALER / ADMIN roles
- registration, approval status, login, JWT authentication
- product catalogue API
- chemist order creation and order listing
- admin user approval/rejection
- private local license-document upload and role-protected download
- admin license review API
- inventory batch schema (batch number, expiry, quantity)
- payment records/schema and integration placeholders
- audit log schema/API
- WhatsApp integration status and placeholder
- basic security headers, rate limiting, password hashing, input checks

अभी क्या production-ready नहीं है:
- Razorpay payment creation और signed webhook verification लागू नहीं है
- WhatsApp Cloud API send logic/templates लागू नहीं हैं
- GST invoice generation/tax rules लागू नहीं हैं
- inventory batch allocation, stock reservation and expiry-aware dispatch logic लागू नहीं है
- dealer assignment workflow को business rules के अनुसार finalize करना है
- license files का local storage Render जैसे ephemeral host पर स्थायी नहीं है; production में private object storage चाहिए
- backup/restore, monitoring, tests, legal/privacy review और external security review जरूरी हैं
- frontend में अभी पूरा login/admin dashboard नहीं है; APIs हैं जिन्हें UI से जोड़ना बाकी है

कृपया इस starter को production-ready या पूरी तरह सुरक्षित न मानें।
असली ग्राहक डेटा, licence documents, orders या payments तब तक इस्तेमाल न करें जब तक
सभी अधूरे integrations और security tests पूरे न हो जाएँ।

CLOUD DEPLOYMENT OVERVIEW (no Docker Desktop needed)
1. ZIP को extract करें।
2. GitHub में नई repository बनाएं और extracted files/folders upload करें.
3. Render में Web Service बनाकर repository connect करें.
4. Build command: npm install
5. Start command: npm start
6. Render Environment Variables में DATABASE_URL और JWT_SECRET सेट करें.
7. PostgreSQL database (उदाहरण: Supabase) बनाकर connection string लें.
8. Deployment से पहले Prisma client generate और schema apply करें:
   npm run db:generate
   npm run db:push
   (Cloud build command में सामान्यतः `npm install && npx prisma generate` रखें;
   database schema apply को provider shell/one-off command से करें.)
9. Admin seed account बनाने के लिए SEED_ADMIN_EMAIL और SEED_ADMIN_PASSWORD को
   सुरक्षित environment variables में रखें और `npm run db:seed` चलाएँ.
10. /api/health endpoint खोलकर health check करें.

Secrets:
- असली `.env` GitHub में upload न करें.
- JWT_SECRET लंबा random secret हो.
- API keys सिर्फ hosting provider के Environment Variables में रखें.
- Seed admin password को सुरक्षित रखें और बाद में बदलें.

FREE PLAN CAUTION:
Free hosting/database plans की limits और availability बदल सकती है. Free instances sleep/pause हो सकती हैं,
database expire/pause हो सकता है, और local uploads redeploy/restart पर खो सकते हैं.
Real business use से पहले paid/stable database, private object storage, verified backups
और restore test की योजना जरूरी है.

पुरानी vardion-proffesional contact-collection website को इससे अलग ही रखें।
