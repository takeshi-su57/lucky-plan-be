-- CreateTable
CREATE TABLE "FollowerAction" (
    "id" SERIAL NOT NULL,
    "actionId" INTEGER NOT NULL,
    "taskId" INTEGER NOT NULL,

    CONSTRAINT "FollowerAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowerAction_actionId_key" ON "FollowerAction"("actionId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowerAction_actionId_taskId_key" ON "FollowerAction"("actionId", "taskId");

-- AddForeignKey
ALTER TABLE "FollowerAction" ADD CONSTRAINT "FollowerAction_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
