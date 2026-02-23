pub type MintRedeemer {
  Mint
  Burn
  Revoke
}

pub type StoreRedeemer {
  Update
  Remove
  Minting
}

pub const author_key: ByteArray = "_pk"
pub const receivers_raw_key: ByteArray = "receivers_raw"
