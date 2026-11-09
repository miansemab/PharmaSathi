# PharmaSathi – Pharmacy Management System

**A modern, offline-first pharmacy management solution built to simplify medicine inventory, billing, purchases, and pharmacy operations.**

PharmaSathi is a desktop-based pharmacy management application designed to help small and growing pharmacies manage their daily operations efficiently. It provides tools for managing medicines, tracking stock, monitoring expiry dates, processing purchases, and viewing business activity through a centralized dashboard.

The project focuses on delivering a fast, lightweight, and user-friendly experience, with a foundation for pharmacy-specific data management and future cloud-connected capabilities.

---

## Key Features

- **Dashboard:** View inventory summaries, stock status, low-stock alerts, expiry alerts, and monthly sales information.
- **Medicine Management:** Maintain medicine records and manage inventory batches.
- **Stock Monitoring:** Identify low-stock medicines and medicines approaching expiry.
- **Point of Sale (POS):** Dedicated billing workspace for pharmacy sales.
- **Purchase Management:** Record and manage pharmacy purchases.
- **Reports:** Access pharmacy-related business and inventory information.
- **Authentication:** User login, logout, and account verification workflows.
- **Offline Support:** Local desktop database and offline authentication capabilities.
- **Pharmacy Data Isolation:** Device-scoped pharmacy data management.
- **Shared Medicine Catalogue:** Central medicine catalogue with catalogue review functionality.
- **Theme Support:** Switch between light and dark themes.

## Technology Stack

| Technology | Purpose |
|---|---|
| React | User interface |
| TypeScript | Type safety |
| Vite | Development and build tooling |
| Electron | Desktop application |
| Node.js | Backend runtime |
| SQLite | Local desktop data storage |
| Prisma ORM | Database access and schema management |
| Neon | Cloud PostgreSQL database |
| CSS | Application styling |

## Project Structure

```text
PharmaSathi/
├── electron/
│   ├── database.cjs
│   ├── main.cjs
│   ├── preload.cjs
│   ├── device-identity.cjs
│   └── offline-auth.cjs
├── prisma/
│   └── migrations/
├── scripts/
│   ├── diagnose-catalogue.ts
│   └── import-drap-catalogue.ts
├── server/
│   ├── index.ts
│   ├── email.ts
│   └── otp.ts
├── src/
│   ├── App.tsx
│   ├── App.css
│   ├── AuthScreen.tsx
│   └── CatalogueReview.tsx
├── package.json
└── vite.config.ts
```

## Getting Started

### Prerequisites

Make sure you have the following installed:

- Node.js
- npm
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/miansemab/PharmaSathi.git
```

### 2. Navigate to the Project

```bash
cd PharmaSathi
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Development Application

```bash
npm run electron:dev
```

### 5. Create a Production Build

```bash
npm run build
```

**Note:** Cloud-backed features may require the relevant environment variables and database configuration. Follow the project's environment configuration before using those features.

## Development Status

PharmaSathi is under active development.

The current implementation includes the core pharmacy workspace, desktop database integration, authentication workflows, inventory management, purchase management, and shared medicine catalogue functionality.

Features and workflows are being improved and tested as the project evolves.

## Project Goals

- Simplify everyday pharmacy operations.
- Reduce manual inventory management.
- Improve medicine stock and expiry tracking.
- Provide a lightweight desktop experience.
- Support pharmacy-specific data management.
- Build a foundation for future cloud synchronization and scalability.

## Future Direction

Planned areas of improvement include:

- Enhanced sales and financial reporting.
- Advanced inventory analytics.
- Improved cloud synchronization.
- Expanded medicine catalogue coverage.
- Multi-device and multi-pharmacy workflows.
- Performance and usability improvements.

## Author

**Mian Semab**

GitHub: [@miansemab](https://github.com/miansemab)

## Repository

[PharmaSathi – GitHub Repository](https://github.com/miansemab/PharmaSathi)

---

*PharmaSathi — Smarter Pharmacy Management.*
