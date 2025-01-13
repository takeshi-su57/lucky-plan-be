-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "categoryId" INTEGER;

-- CreateTable
CREATE TABLE "TagCategory" (
    "id" SERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "TagCategory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TagCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
