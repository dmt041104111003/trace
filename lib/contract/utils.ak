use aiken/builtin
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId, flatten, without_lovelace}
use cardano/minting
use cardano/transaction.{InlineDatum, Input, Output}
use cardano/tx
use contract/types
use types/cip68.{CIP68}
use validation/find

pub fn check_output_utxo(
  output: Output,
  issuer: VerificationKeyHash,
  vks: List<VerificationKeyHash>,
) -> Bool {
  expect InlineDatum(data) = output.datum
  expect metadatum: CIP68 = data
  expect author: VerificationKeyHash = cip68.get(metadatum, types.author_key)
  let output_value =
    output.value
      |> without_lovelace()
      |> flatten()
  and {
    author == issuer,
    tx.verify_signature(vks, author),
    list.length(output_value) == 1,
  }
}

pub fn check_output_remove(outputs: List<Output>, addr: Address) -> Bool {
  list.any(
    outputs,
    fn(output) { output.address.payment_credential == addr.payment_credential },
  )
}

pub fn check_output_update(
  inputs: List<Input>,
  outputs: List<Output>,
  address: Address,
) -> Bool {
  let utxo_outputs =
    list.filter(outputs, fn(output) { output.address == address })

  let utxo_inputs =
    list.filter(inputs, fn(input) { input.output.address == address })

  list.length(utxo_outputs) == list.length(utxo_inputs)
}

pub fn filter_and_pair(
  flat: List<(PolicyId, AssetName, Int)>,
  prefix100: ByteArray,
  prefix222: ByteArray,
) -> List<(PolicyId, AssetName, AssetName, Int)> {
  let filter100 =
    list.filter(
      flat,
      fn((_policy_id, asset_name, _amount)) {
        bytearray.starts_with(asset_name, prefix100)
      },
    )
  let filter222 =
    list.filter(
      flat,
      fn((_policy_id, asset_name, _amount)) {
        bytearray.starts_with(asset_name, prefix222)
      },
    )
  let asset_names_amounts100 =
    list.map(
      filter100,
      fn((policy_id, asset_name, amount)) { (policy_id, asset_name, amount) },
    )
  let asset_names_amounts222 =
    list.map(
      filter222,
      fn((policy_id, asset_name, amount)) { (policy_id, asset_name, amount) },
    )

  let sorted100 =
    list.sort(
      asset_names_amounts100,
      fn((_, name1, _), (_, name2, _)) { bytearray.compare(name1, name2) },
    )
  let sorted222 =
    list.sort(
      asset_names_amounts222,
      fn((_, name1, _), (_, name2, _)) { bytearray.compare(name1, name2) },
    )

  let paired = list.zip(sorted100, sorted222)
  list.map(
    paired,
    fn(((policy_id1, name1, _amount1), (_policy_id2, name2, amount2))) {
      (policy_id1, name1, name2, amount2)
    },
  )
}

pub fn check_assets_prefix(
  flatten: List<(PolicyId, AssetName, Int)>,
  policy_id: PolicyId,
  prefix: ByteArray,
) -> Bool {
  let filtered =
    list.filter(
      flatten,
      fn((_policy_id, asset_name, _amount)) {
        bytearray.starts_with(asset_name, prefix)
      },
    )

  let pairs =
    list.map(
      filtered,
      fn((_policy_id, asset_name, amount)) { (asset_name, -amount) },
    )
  list.foldl(
    pairs,
    True,
    fn((asset_name, amount), acc) {
      if !acc {
        False
      } else {
        and {
          amount == 1,
          minting.by_prefix(flatten, policy_id, cip68.prefix_222, -amount)?,
          minting.exact(flatten, policy_id, asset_name, -amount)?,
        }
      }
    },
  )
}

pub fn find_input_reference_asset(
  inputs: List<Input>,
  vks: List<VerificationKeyHash>,
) -> List<(PolicyId, AssetName, Int)> {
  list.filter_map(
    inputs,
    fn(input) {
      when input.output.datum is {
        InlineDatum(data) -> {
          expect metadatum: CIP68 = data
          expect author: VerificationKeyHash =
            cip68.get(metadatum, types.author_key)
          if tx.verify_signature(vks, author) {
            let reference_asset =
              input.output.value
                |> without_lovelace()
                |> assets.flatten()
            let exist =
              list.find(
                reference_asset,
                fn((_policy_id, asset_name, _amount)) {
                  bytearray.starts_with(asset_name, cip68.prefix_100)
                },
              )
            when exist is {
              Some((policy_id, asset_name, amount)) ->
                Some((policy_id, asset_name, amount))
              None -> None
            }
          } else {
            None
          }
        }
        _ -> None
      }
    },
  )
}

pub fn find_ref100_datum_in_reference_inputs(
  reference_inputs: List<Input>,
  policy_id: PolicyId,
  prefix100: ByteArray,
  prefix222: ByteArray,
  mint_flatten: List<(PolicyId, AssetName, Int)>,
) -> Option<CIP68> {
  let rft_suffixes =
    list.map(
      list.filter(
        mint_flatten,
        fn((_p, name, amt)) {
          and {
            bytearray.starts_with(name, prefix222),
            amt < 0,
          }
        },
      ),
      fn((_p, name, _amt)) { bytearray.drop(name, bytearray.length(prefix222)) },
    )
  let found =
    list.filter_map(
      reference_inputs,
      fn(input) {
        when input.output.datum is {
          InlineDatum(data) -> {
            expect metadatum: CIP68 = data
            let flat =
              input.output.value
                |> without_lovelace()
                |> flatten()
            let ref100 =
              list.find(
                flat,
                fn((p, name, _amt)) {
                  and {
                    p == policy_id,
                    bytearray.starts_with(name, prefix100),
                    list.any(
                      rft_suffixes,
                      fn(suffix) {
                        bytearray.compare(
                          bytearray.drop(name, bytearray.length(prefix100)),
                          suffix,
                        ) == Equal
                      },
                    )
                  }
                },
              )
            when ref100 is {
              Some(_) -> Some(metadatum)
              None -> None
            }
          }
          _ -> None
        }
      },
    )
  list.head(found)
}

fn hex_nibble(b: Int) -> Option<Int> {
  if b >= 48 && b <= 57 {
    Some(b - 48)
  } else if b >= 97 && b <= 102 {
    Some(b - 87)
  } else if b >= 65 && b <= 70 {
    Some(b - 55)
  } else {
    None
  }
}

fn hex_decode_bytearray(bytes: ByteArray) -> Option<ByteArray> {
  let len = bytearray.length(bytes)
  if len % 2 != 0 {
    None
  } else {
    list.range(0, len / 2 - 1)
      |> list.foldl(_, Some(#""), fn(i, acc) {
        when acc is {
          None -> None
          Some(so_far) -> {
            when hex_nibble(builtin.index_bytearray(bytes, i * 2)) is {
              Some(hi) -> when hex_nibble(builtin.index_bytearray(bytes, i * 2 + 1)) is {
                Some(lo) -> {
                  let byte = hi * 16 + lo
                  Some(bytearray.concat(so_far, bytearray.from_int_big_endian(byte, 1)))
                }
                None -> None
              }
              None -> None
            }
          }
        }
      })
  }
}

fn parse_receivers_raw(bytes_hex: ByteArray) -> List<VerificationKeyHash> {
  when hex_decode_bytearray(bytes_hex) is {
    None -> []
    Some(decoded) -> {
      let n = bytearray.length(decoded) / 28
      list.range(0, n - 1)
        |> list.map(fn(i) {
          bytearray.slice(decoded, i * 28, (i + 1) * 28 - 1)
        })
    }
  }
}

fn get_optional_metadata(cip68: CIP68, key: ByteArray) -> Option<Data> {
  let found =
    list.filter_map(
      cip68.metadata,
      fn(pair) {
        if builtin.fst_pair(pair) == builtin.b_data(key) {
          Some(builtin.snd_pair(pair))
        } else {
          None
        }
      },
    )
  list.head(found)
}

pub fn get_receivers_from_metadatum(metadatum: CIP68) -> List<VerificationKeyHash> {
  when get_optional_metadata(metadatum, types.receivers_raw_key) is {
    Some(data) -> {
      expect bytes_raw: ByteArray = data
      parse_receivers_raw(bytes_raw)
    }
    None -> []
  }
}

pub fn burner_in_allowlist(
  extra_signatories: List<VerificationKeyHash>,
  receivers: List<VerificationKeyHash>,
  author: VerificationKeyHash,
) -> Bool {
  list.any(
    extra_signatories,
    fn(sig) {
      or {
        sig == author,
        list.any(receivers, fn(r) { sig == r }),
      }
    },
  )
}

pub fn check_asset_mint(
  flatten: List<(PolicyId, AssetName, Int)>,
  policy_id: PolicyId,
  prefix100: ByteArray,
  prefix222: ByteArray,
  outputs: List<Output>,
  store_address: Address,
  issuer: VerificationKeyHash,
  extra_signatories: List<VerificationKeyHash>,
  has_reference: Bool,
) -> Bool {
  let pairs = filter_and_pair(flatten, prefix100, prefix222)

  list.foldl(
    pairs,
    True,
    fn((_policy_id, reference_asset_name, asset_name_222, amount), acc) {
      if !acc {
        False
      } else {
        let reference_value =
          assets.from_asset(policy_id, reference_asset_name, 1)
        let output_utxo_store =
          find.output_by_addr_value(outputs, store_address, reference_value)
        and {
          amount == 1,
          check_output_utxo(output_utxo_store, issuer, extra_signatories)?,
          check_pair_asset_name(reference_asset_name, asset_name_222),
          check_minting_reference(
            flatten,
            policy_id,
            reference_asset_name,
            has_reference,
          ),
          minting.exact(flatten, policy_id, asset_name_222, amount)?,
        }
      }
    },
  )
}

pub fn check_asset_burn(
  flatten: List<(PolicyId, AssetName, Int)>,
  policy_id: PolicyId,
  prefix100: ByteArray,
  prefix222: ByteArray,
) -> Bool {
  let pairs = filter_and_pair(flatten, prefix100, prefix222)

  list.foldl(
    pairs,
    True,
    fn((_policy_id, reference_asset_name, asset_name_222, amount), acc) {
      if !acc {
        False
      } else {
        and {
          amount == -1,
          check_pair_asset_name(reference_asset_name, asset_name_222),
          minting.exact(flatten, policy_id, reference_asset_name, -1)?,
          minting.exact(flatten, policy_id, asset_name_222, -amount)?,
          minting.by_prefix(flatten, policy_id, cip68.prefix_100, -1)?,
          minting.by_prefix(flatten, policy_id, cip68.prefix_222, -amount)?,
        }
      }
    },
  )
}

pub fn check_asset_revoke(
  mint_flatten: List<(PolicyId, AssetName, Int)>,
  policy_id: PolicyId,
) -> Bool {
  let no_rft =
    list.length(
      list.filter(
        mint_flatten,
        fn((_policy_id, asset_name, _amount)) {
          bytearray.starts_with(asset_name, cip68.prefix_222)
        },
      ),
    ) == 0
  and {
    minting.by_prefix(mint_flatten, policy_id, cip68.prefix_100, -1),
    no_rft,
  }
}

pub fn check_minting_reference(
  flatten: List<(PolicyId, AssetName, Int)>,
  policy_id: PolicyId,
  reference_asset_name: AssetName,
  has_reference: Bool,
) -> Bool {
  if has_reference {
    True
  } else {
    and {
      minting.exact(flatten, policy_id, reference_asset_name, 1)?,
      minting.by_prefix(flatten, policy_id, cip68.prefix_100, 1),
    }
  }
}

pub fn check_pair_asset_name(
  reference_asset_name: AssetName,
  asset_name_222: AssetName,
) -> Bool {
  bytearray.compare(
    bytearray.drop(reference_asset_name, 4),
    bytearray.drop(asset_name_222, 4),
  ) == Equal
}
