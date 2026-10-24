Vardion Healthcare Portal - Product Delete Fix

Replace the repository root server.js with server.js.
Replace public/index.html with public/index.html.

Product removal is Admin-only and uses soft deletion (isActive=false), preserving old order records. Admin can restore inactive products from the product catalogue. No Prisma schema migration is required for this change because it uses the existing Product.isActive field.

After committing both files, wait for Render to redeploy. Test as Admin: Product catalogue > Delete product, then Restore. Non-admin users must not see product delete controls and the API rejects non-admin deletion.
