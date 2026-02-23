import { Module } from "@nestjs/common";
import { CardanoModule } from "../cardano/cardano.module";
import { TraceService } from "./trace.service";
import { TraceController } from "./trace.controller";

@Module({
  imports: [CardanoModule],
  controllers: [TraceController],
  providers: [TraceService],
  exports: [TraceService],
})
export class TraceModule {}
