-- Username becomes the sign-in identifier; email becomes optional.
--
-- Done in three steps rather than one so that existing rows survive: the column
-- is added nullable, backfilled from the email local-part (de-duplicated, since
-- alice@a.com and alice@b.com both want "alice"), and only then made NOT NULL.

ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- Backfill: local-part of the email, narrowed to the character set the
-- application accepts, with a numeric suffix wherever that collides.
WITH candidate AS (
  SELECT
    "id",
    regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9._-]', '', 'g') AS base,
    row_number() OVER (
      PARTITION BY regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9._-]', '', 'g')
      ORDER BY "createdAt", "id"
    ) AS n
  FROM "User"
)
UPDATE "User" u
SET "username" = CASE
  WHEN c.base = '' OR c.base IS NULL THEN 'user' || left(replace(u."id", '-', ''), 8)
  WHEN c.n = 1 THEN c.base
  ELSE c.base || c.n::text
END
FROM candidate c
WHERE u."id" = c."id";

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

-- Email is no longer required: an account can exist with no address on file.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_username_idx" ON "User"("username");
