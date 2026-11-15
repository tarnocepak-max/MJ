# MoraJaws UI/UX update — implementation report

## Applied source changes
- Replaced the DashboardOverview contractor performance/coverage and appointment-date dashboard with a compact operational summary (active WO, attention, in-progress, completed) and quick links.
- Replaced the fifth Android bottom-navigation Menu drawer toggle with a LiveChat navigation item.
- Added an unread-message badge to the bottom-navigation LiveChat item, calculated from loaded ticketMessages and each message's readBy list.
- Changed the TicketsTable "Chat Unread" action from a local filter toggle to navigation to the Contact Centre / LiveChat page.
- Removed the default sidebar navigation entry "Pengaturan Kuota & Kolom Visibilitas".
- Removed the visible "Refresh Data" button from LeaderPortal without removing synchronization logic.
- Changed the Setup Terpusat header from a dark gradient to a light surface.

## Verification performed
Source-level assertions passed for all seven changes above.

## Not completed / requires additional implementation and runtime validation
- Technician quota UI has not yet been relocated into the technician registration form. The existing quota page/component remains in the codebase and its data logic was not changed.
- Full role-specific light accent themes have not been implemented.
- The full-app delete-button audit and confirmation-dialog enforcement have not been completed. Existing delete APIs/modals were preserved; no claim is made that every delete control is now functional.
- LiveChat read receipts and blue double-check behavior have not been comprehensively changed or verified. Existing mark-as-read behavior was preserved. New-message sound notification behavior and cross-session synchronization remain unverified.
- The unread badge uses the ticketMessages currently loaded in the client; it is not proof of a server-wide unread count.
- Full UI simplification across every screen and responsive device testing remain outstanding.
- TypeScript, lint, production build, and integration tests were not run because dependencies are not installed in this workspace.
- No database migration, Production connection, or database write was performed.

## Safety
No Work Order records, user accounts, roles, contractor records, or production database objects were modified by this ZIP edit.
