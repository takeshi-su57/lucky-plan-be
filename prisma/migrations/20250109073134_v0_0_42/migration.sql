/*
  Warnings:

  - A unique constraint covering the columns `[category]` on the table `TagCategory` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "TagCategory_category_key" ON "TagCategory"("category");
