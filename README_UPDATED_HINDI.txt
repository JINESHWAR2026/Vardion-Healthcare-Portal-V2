VARDION HEALTHCARE PORTAL V2 — UPDATED PATCH

Is package mein:
1) Chemist/Dealer account remove action ab linked orders/dispatch history hone par hard-delete karne ke bajay account ko SUSPENDED (archived) karta hai. Isse login band hota hai aur purane orders/licence documents preserve rehte hain.
2) Jis account ka koi linked business history nahi hai, use permanently delete kiya ja sakta hai.
3) Prisma User schema mein correctionRequestedAt field add kiya gaya hai, jise server.js pehle se use kar raha tha.
4) Delete confirmation text ko archive behaviour ke mutabik update kiya hai.

IMPORTANT DEPLOY STEPS:
- GitHub par ZIP extract karein aur repository ke matching files replace karein. Root folder ke andar ka content upload/commit karein; nested duplicate folder na banayein.
- Commit ke baad Render deploy complete hone dein.
- Render Shell/Build step mein database schema apply karne ke liye `npx prisma db push` aur `npx prisma generate` chalayein (ya existing migration workflow ke mutabik migration banakar deploy karein). Backup ke bina production DB changes na karein.
- Existing user/order data ko reset na karein. `prisma db push` schema ko update karta hai, data reset karne ke liye `prisma migrate reset` bilkul na chalayein.

TESTING:
- `node --check server.js` passed in this package.
- Live Render database/login/download workflows ko yahan se access karke end-to-end test nahi kiya gaya. Licence files jo pehle se Render local disk se lost ho chuki hain, code se recover nahi hongi; persistent disk/object storage zaroori ho sakta hai.
