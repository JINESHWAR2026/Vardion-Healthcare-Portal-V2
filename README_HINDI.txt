VARDION HEALTHCARE PORTAL V2 — ORDER FIX

Is ZIP mein server.js ka order-related fix hai. Chemist order create karte waqt Prisma Order model ko unsupported distributorId nahi bheja jayega. Order listing/details/status routes se Order ke distributor relation/field references hataaye gaye hain; Admin, Dealer aur Chemist order flow rakha gaya hai.

Deploy:
1. ZIP extract karein.
2. Iske server.js ko apne project ke server.js se replace karein.
3. GitHub par commit/push karein; Render auto-deploy hone dein.
4. Deploy complete hone ke baad Chemist login karke test order place karein, phir Dealer login se order list/status check karein.

Note: Local JavaScript syntax check pass hua. Live Render/database par test nahi kiya gaya. Is patch mein user registration/admin assignment ke legacy Distributor references ko intentionally poori tarah rewrite nahi kiya gaya, kyunki uske liye frontend aur Prisma schema ko saath verify karna zaroori hai.
