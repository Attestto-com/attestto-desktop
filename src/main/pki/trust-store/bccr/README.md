# BCCR Root CA Bundle

This directory holds the **trust anchors** for Costa Rica's Firma Digital PKI. The
desktop app loads every `.cer` / `.crt` / `.pem` file in this directory at startup
and uses them as roots for validating signatures embedded in CR-signed PDFs.

**Adobe Reader does not ship these certs.** Attestto bundles them and Adobe
does not, so signed CR PDFs show "valid" in Attestto and "unknown" in Adobe.
That difference is the reason this validator and trust store exist.

## What to drop here

Download the official chain from the BCCR / SINPE repository:

  https://www.firmadigital.go.cr/Repositorio/

You want every active CA in the path that ends at a Persona Física or Persona
Jurídica signing cert. As of writing the chain is:

  CA RAÍZ NACIONAL DE COSTA RICA          (root)
    └── CA POLÍTICA SINPE - PERSONA FÍSICA  (intermediate)
          └── CA SINPE - PERSONA FÍSICA vNN   (issuing)
    └── CA POLÍTICA SINPE - PERSONA JURÍDICA (intermediate)
          └── CA SINPE - PERSONA JURÍDICA vNN (issuing)
    └── CA POLÍTICA SINPE - SELLO            (intermediate)
          └── CA SINPE - SELLO ELECTRONICO vNN

Download all of them in DER (`.cer`) or PEM (`.pem`) format and save them in
this directory. The validator auto-detects format. Filenames are not
significant — only contents.

**Only the root needs to be marked "trusted"** by the validator; intermediates
will also be validated against the root. But in practice you should drop the
full chain so OCSP / chain building has all the parts it needs without going
to the network.

## Verification

After dropping certs here, the validator startup log will print:

    [firma] loaded N BCCR trust anchors

If you see `[firma] no BCCR trust anchors loaded — validator disabled` then
the directory is empty or the files could not be parsed. Check the file
extensions and that the contents are valid X.509.

## Do NOT commit private keys

Only public certificates (`.cer`, `.crt`, `.pem` containing `CERTIFICATE` PEM
blocks) belong here. There are no private keys in the BCCR public chain — if
you find yourself dropping a `.p12` or `.key` file in this directory, stop.
