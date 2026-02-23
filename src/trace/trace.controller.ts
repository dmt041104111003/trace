import { Controller, Get, Param, Post, Body, BadRequestException } from "@nestjs/common";
import type { PolicyAssetRow, BuildMetadataInput } from "./trace.service";
import { TraceService } from "./trace.service";

@Controller("trace")
export class TraceController {
  constructor(private readonly trace: TraceService) {}

  @Get("policy/:policyId")
  async listByPolicy(@Param("policyId") policyId: string): Promise<{
    policyId: string;
    total: number;
    assets: PolicyAssetRow[];
  }> {
    if (!/^[a-fA-F0-9]{56}$/.test(policyId)) {
      throw new BadRequestException("policyId phải là 56 ký tự hex");
    }
    const assets = await this.trace.listAssetsByPolicy(policyId);
    return {
      policyId,
      total: assets.length,
      assets,
    };
  }

  @Post("metadata/build")
  buildMetadata(@Body() body: BuildMetadataInput): Record<string, string> {
    if (
      !body.pk ||
      body.receivers === undefined ||
      !body.receiver_locations ||
      !body.receiver_coordinates ||
      !body.minter_location ||
      !body.minter_coordinates ||
      !body.name ||
      !body.image
    ) {
      throw new BadRequestException(
        "Thiếu: pk, receivers, receiver_locations, receiver_coordinates, minter_location, minter_coordinates, name, image",
      );
    }
    return this.trace.buildMetadata(body);
  }

  @Post("mint")
  async mint(
    @Body()
    body: {
      changeAddress: string;
      assetName: string;
      metadata: Record<string, string>;
      receiver?: string;
    },
  ): Promise<{ unsignedTx: string }> {
    if (!body.changeAddress || !body.assetName || !body.metadata) {
      throw new BadRequestException("Thiếu changeAddress, assetName hoặc metadata");
    }
    return this.trace.mint(body);
  }

  @Post("update")
  async update(
    @Body()
    body: {
      changeAddress: string;
      assetName: string;
      metadata: Record<string, string>;
      txHash?: string;
    },
  ): Promise<{ unsignedTx: string }> {
    if (!body.changeAddress || !body.assetName || !body.metadata) {
      throw new BadRequestException("Thiếu changeAddress, assetName hoặc metadata");
    }
    return this.trace.update(body);
  }

  @Post("burn")
  async burn(
    @Body()
    body: { changeAddress: string; assetName: string; quantity?: string; txHash?: string },
  ): Promise<{ unsignedTx: string }> {
    if (!body.changeAddress || !body.assetName) {
      throw new BadRequestException("Thiếu changeAddress hoặc assetName");
    }
    return this.trace.burn(body);
  }

  @Post("revoke")
  async revoke(
    @Body()
    body: { changeAddress: string; assetName: string; txHash?: string },
  ): Promise<{ unsignedTx: string }> {
    if (!body.changeAddress || !body.assetName) {
      throw new BadRequestException("Thiếu changeAddress hoặc assetName");
    }
    return this.trace.revoke(body);
  }

  @Post("submit")
  async submit(
    @Body() body: { signedTx: string },
  ): Promise<{ txHash: string }> {
    if (!body.signedTx) {
      throw new BadRequestException("Thiếu signedTx (hex CBOR đã ký)");
    }
    return this.trace.submitSignedTx(body.signedTx);
  }
}
