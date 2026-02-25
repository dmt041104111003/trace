use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{VerificationKey}
use cardano/transaction.{OutputReference, Transaction}

pub type Datum {
    owners: List<VerificationKeyHash>,
    threshold: Int,
    recipient: VerificationKeyHash,
}

pub type Redeemer { Spend }

validator multisig {
    spend(
        datum: Option<Datum>,
        _redeemer: Redeemer,
        _own_ref: OutputReference,
        self: Transaction,
    ) {
        let version = 1
        expect version == 1
        expect Some(Datum {owners, threshold, recipient}) = datum

        let signatures = list.filter(owners, fn(owner) { list.has(self.extra_signatories, owner)})
        let num_signatures = list.length(signatures)
        let has_enough_signatures = num_signatures >= threshold
        let recipient_cred = VerificationKey(recipient)
        let pays_to_recipient =
            list.any(
                self.outputs,
                fn(output) { output.address.payment_credential == recipient_cred },
            )
        has_enough_signatures && pays_to_recipient
    }

    else(_){
        fail
    }
}
