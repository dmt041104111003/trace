import { Module } from "@nestjs/common";
import { ConfigModule } from "../config/config.module";
import { Cip68UtilsService } from "./cip68-utils.service";

@Module({
  imports: [ConfigModule],
  providers: [Cip68UtilsService],
  exports: [Cip68UtilsService],
})
export class Cip68Module {}
