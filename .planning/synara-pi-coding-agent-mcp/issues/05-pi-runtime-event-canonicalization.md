# Pi runtime event canonicalization

Labels: `wayfinder:task`

## Question

What implementation contract and test coverage should normalize Pi tool output
before `item.updated` and `item.completed` enter `ProviderRuntimeEvent`, retain
lossless raw output, and eliminate whitespace-induced journal quarantine without
weakening the canonical schema or journal-first delivery?
