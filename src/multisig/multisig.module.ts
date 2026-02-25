import { Module } from "@nestjs/common";
import { ConfigModule } from "../config/config.module";
import { MultisigService } from "./multisig.service";

@Module({
  imports: [ConfigModule],
  providers: [MultisigService],
  exports: [MultisigService],
})
export class MultisigModule {}
