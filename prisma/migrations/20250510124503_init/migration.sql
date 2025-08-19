-- DropForeignKey
ALTER TABLE "SubredditBan" DROP CONSTRAINT "SubredditBan_bannedBy_fkey";

-- DropForeignKey
ALTER TABLE "SubredditBan" DROP CONSTRAINT "SubredditBan_subredditId_fkey";

-- DropForeignKey
ALTER TABLE "SubredditBan" DROP CONSTRAINT "SubredditBan_userId_fkey";

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "height" INTEGER,
ADD COLUMN     "publicId" TEXT,
ADD COLUMN     "width" INTEGER;

-- AddForeignKey
ALTER TABLE "SubredditBan" ADD CONSTRAINT "SubredditBan_subredditId_fkey" FOREIGN KEY ("subredditId") REFERENCES "Subreddit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubredditBan" ADD CONSTRAINT "SubredditBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubredditBan" ADD CONSTRAINT "SubredditBan_bannedBy_fkey" FOREIGN KEY ("bannedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
