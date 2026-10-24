VARDION HEALTHCARE PORTAL V2 — SERVER + INDEX FIX

Replace only these two files in your GitHub repository:
1) server.js -> repository root/server.js
2) public/index.html -> repository/public/index.html

Then commit changes and wait for Render deployment to finish.
Do NOT reset the database. Do NOT replace prisma/schema.prisma from this package.

Checks performed on this package: Node syntax check passed for server.js and the inline JavaScript in public/index.html. This is not an end-to-end test against your live Render service/database. After deploy, test with a non-admin test account: correction request -> Admin Allow correction -> user login -> edit profile -> resubmit -> Admin review; also check account linking and notifications for each role.
