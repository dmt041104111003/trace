use aiken/collection/list
use aiken/crypto.{ScriptHash, VerificationKeyHash}
use cardano/address
use cardano/assets.{PolicyId, without_lovelace}
use cardano/transaction.{Transaction}
use contract/types
use contract/utils
use types/cip68

validator mint(
  store_payment_credential: ScriptHash,
  store_stake_credential: VerificationKeyHash,
  issuer: VerificationKeyHash,
) {
  mint(redeemer: types.MintRedeemer, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { inputs, outputs, extra_signatories, mint, reference_inputs, .. } =
      transaction
    let mint_flatten =
      mint
        |> without_lovelace()
        |> assets.flatten()
    let store_address =
      store_payment_credential
        |> address.from_script()
        |> address.with_delegation_key(store_stake_credential)
    when redeemer is {
      types.Mint -> {
        let reference_asset =
          utils.find_input_reference_asset(inputs, extra_signatories)
        if list.length(reference_asset) > 0 {
          False
        } else {
          utils.check_asset_mint(
            mint_flatten,
            policy_id,
            cip68.prefix_100,
            cip68.prefix_222,
            outputs,
            store_address,
            issuer,
            extra_signatories,
            False,
          )?
        }
      }
      types.Burn -> {
        let reference_asset =
          utils.find_input_reference_asset(inputs, extra_signatories)
        if list.length(reference_asset) > 0 {
          let mint_concat = list.concat(reference_asset, mint_flatten)
          utils.check_asset_burn(
            mint_concat,
            policy_id,
            cip68.prefix_100,
            cip68.prefix_222,
          )?
        } else {
          let ref100_datum =
            utils.find_ref100_datum_in_reference_inputs(
              reference_inputs,
              policy_id,
              cip68.prefix_100,
              cip68.prefix_222,
              mint_flatten,
            )
          when ref100_datum is {
            Some(metadatum) -> {
              expect author: VerificationKeyHash =
                cip68.get(metadatum, types.author_key)
              let receivers = utils.get_receivers_from_metadatum(metadatum)
              and {
                utils.burner_in_allowlist(
                  extra_signatories,
                  receivers,
                  author,
                ),
                utils.check_assets_prefix(
                  mint_flatten,
                  policy_id,
                  cip68.prefix_222,
                )?,
              }
            }
            None -> False
          }
        }
      }
      types.Revoke -> {
        let reference_asset =
          utils.find_input_reference_asset(inputs, extra_signatories)
        and {
          list.length(reference_asset) > 0,
          utils.check_asset_revoke(mint_flatten, policy_id)?,
        }
      }
    }
  }

  else(_) {
    fail
  }
}
