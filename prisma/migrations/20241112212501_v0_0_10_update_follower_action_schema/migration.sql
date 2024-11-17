-- AddForeignKey
ALTER TABLE "FollowerAction" ADD CONSTRAINT "FollowerAction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
