-- CreateTable
CREATE TABLE "SubredditBan" (
    "id" SERIAL NOT NULL,
    "subredditId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "bannedBy" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubredditBan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubredditBan_subredditId_userId_key" ON "SubredditBan"("subredditId", "userId");

-- AddForeignKey
ALTER TABLE "SubredditBan" ADD CONSTRAINT "SubredditBan_subredditId_fkey" FOREIGN KEY ("subredditId") REFERENCES "Subreddit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubredditBan" ADD CONSTRAINT "SubredditBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubredditBan" ADD CONSTRAINT "SubredditBan_bannedBy_fkey" FOREIGN KEY ("bannedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
