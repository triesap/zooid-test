relay_url := "ws://localhost:3334"

test:
    pnpm test -- --identity 'relay_admin' --identity2 'member_1' --relay {{relay_url}}
