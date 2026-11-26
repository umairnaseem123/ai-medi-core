-- CreateTable
CREATE TABLE "CareRecord" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "pulse" INTEGER,
    "temperatureC" DOUBLE PRECISION,
    "oxygenSat" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareRecord_hospitalId_patientId_createdAt_idx" ON "CareRecord"("hospitalId", "patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "CareRecord" ADD CONSTRAINT "CareRecord_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareRecord" ADD CONSTRAINT "CareRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareRecord" ADD CONSTRAINT "CareRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
