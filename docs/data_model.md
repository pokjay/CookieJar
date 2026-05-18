# Data model

The data is saved in a PostgreSQL database under the `moneyman` schema. All objects live in this schema and queries use it as the default `search_path`.

Some data is automatically imported from Israeli banks and credit cards via [moneyman](https://github.com/daniel-hauser/moneyman); the rest is entered manually through the app.

## Schema source of truth

The authoritative, machine-readable schema lives in [`db/migrations/`](../db/migrations/). Run `dbmate dump` after applying migrations to regenerate `db/schema.sql`, which is the single-file schema reference for tooling and AI agents.

This document describes the **semantic meaning** of each table and column — the structural DDL is in the migration files.

## processed_transcations_with_categories
This view includes the individual expenses and the mapped category and subcategory if they exist
The view is a join of:
    - `transactions` table created by the Moneyman tool and has the individual expenses
    - transactions_manual table which has individual expenses or income added manually in the same format as `transactions` table
    - `business_transaction_mappings` table which has manually inputted mappings of broad businesses transactions to the actual business (e.g ordering food through a food delivery app)
    - `description_to_category` table which has manually inputted category and subcategories for each unique description

### Columns
- unique_id (text): ID of the transaction created by our systems
- company_id (text): Name of the credit card company
- account (text): Name or number of the account / credit card
- status (text): Status of the transaction (completed, pending, etc...). Can ignore, mine are always completed
- activity_date (date): Date of the transaction
- charged_amount (numeric): Amount which was charged from the account after currency conversions. Use this column for transaction charge amounts
- orignial_charged_amount (numeric): Amount which was charged from the account but is negative
- charged_currency (text): The currency which was charged from the account
- original_amount (numeric): Original amount of the transaction in original currency
- original_currency (text): Original currency of the transaction
- description (text): The name of the business
- processed_description (varchar): The description mapped if business has mappings in business_transaction_mappings table
- category (text): The category if transaction has mapping in description_to_category table
- subcategory (text): The subcategory if transaction has mapping in description_to_category table
- memo (text): N/A
- identifier (text): ID of the transaction created by our the bank or credit card systems
- installments (jsonb): Info about transactions which were paid with installments
- created_at (text): Creation date of the transaction
- updated_at (text): Update date of the transaction (If transactions grabber ran multiple times and fetched the transaction)

## description_to_category
This table has manually inputted category and subcategories for each unique description

### Columns
- id (int4): Unique ID
- description (text): Description of the business, as seen in the transactions table
- category (text): Category relevant to the business
- subcategory (text): Subcategory relevant to the business

### Categories and subcategories
|category|subcategory|
|--------|-----------|
|ATM|ATM|
|Bills|Phone and Internet|
|Bills|Water|
|Bills|Electricity|
|Bills|Gas|
|Car|License Tax|
|Car|Gas|
|Car|Garage|
|Car|Parking|
|Cashback|Cashback|
|Coffee|Beans|
|Coffee|Coffee|
|Eating Out|Food|
|Eating Out|Pub|
|Eating Out|Deli|
|Gifts|Gifts|
|Health & Sports|Gym|
|Home|Maintenance|
|Home|Electronics|
|Home|Furniture|
|Home|Other|
|Insurance|Insurance|
|Internet Services|Password Manager|
|Internet Services|Streaming|
|Other|Payment Apps|
|Other|Other|
|Other|Card Fee Waiver|
|Payments and Taxes|Import Tax|
|Payments and Taxes|Social Security|
|Payments and Taxes|Passport tax|
|Personal Care|Glasses|
|Personal Care|Haircut|
|Pharmacy|Pharmacy|
|Pharmacy|Natural|
|Pharmacy|Shampoo|
|Shopping|Baby Other|
|Shopping|Alcohol|
|Shopping|KSP|
|Shopping|Gift Cards|
|Shopping|Other|
|Shopping|Amazon|
|Shopping|Baby Clothes|
|Shopping|Video Games|
|Shopping|Baby Stroller|
|Shopping|Toys|
|Supermarket|Supermarket|
|Supermarket|Water|
|Supermarket|Deli|
|Supermarket|Nitzi|
|Supermarket|greengrocer|
|Transportation|Bus|
|Transportation|Taxi|
|Travel|Groceries|
|Travel|Shopping|
|Travel|Gas|
|Travel|Coffee|
|Travel|Beer|
|Travel|Insurance|
|Travel|ATM|
|Travel|Tickets|
|Travel|Car Rental|
|Travel|Eating Out|
|Travel|Baby stuff|
|Travel|Other|
|Travel|Hotel|
|Travel|?|
|Travel|Flights|
|Travel|Sim|
|Travel|Gifts|
|Wolt|Deli|
|Wolt|Wolt|
|Wolt|Bakery|
|Wolt|Wolt+|
|Wolt|Restaurant|

## business_transaction_mappings
Table which has manually inputted mappings of broad businesses transactions to the actual business (e.g ordering food through a food delivery app)

### Columns
- unique_id (text): Unique id from the transactions table
- business_descriptions_id (int4): Foreign key to business_descriptions

## business_descriptions
Table which has manually inputted mappings of broad businesses transactions to the actual business (e.g ordering food through a food delivery app)

### Columns
- id (int4): Unique ID
- description (varchar): The name of the business

## monthly_cash_flow
Table which holds the overall income and expense for each month

### Columns
- year
- month
- person (text): The person the account belongs to
- account: The bank account tracking
- income: Monthly income for the account
- expense: Monthly Expense for the account
- money_transferred: Money transferred into account but isn't income (e.g friends paying back for food)
- savings: Amount transferred from account to any type of savings or investments
- comments

## investment_accounts
This table tracks our familys' investment accounts details

### Columns
- id (int4) - Auto generated sequential unique ID
- person (text): The person the account belongs to
- company (enum): The investment company where the account is
- account_type (enum): Type of account (חשבון השקעות פרטי, קרן השתלמות, פק״מ, קרן כספית, קרן פנסיה מקיפה, קרן פנסיה משלימה, ביטוח מנהלים, קופת גמל, עובר ושב, חסכון לכל ילד, קופת גמל להשקעה)
- account_type_category (text): High level category of the account type (השקעות, כרית בטחון, פנסיה, קרן השתלמות, עובר ושב)
- is_active (bool): If the account still has active deposits?
- is_pension (bool): If the account is usable only for pension (Can't use until age ~67)
- deposit_management_fees (NUMERIC): Management fee from the deposits to the account
- acc_management_fees (NUMERIC): Management fee from the total accumulation of the account (Assets Under Management - AUM)
- investment_track (text): What is the account investing in
- monthly_deposit (numeric): Total amount deposited each month
- account_number (text): The account number from the investment company

## investment_accounts_tracking
This table tracks our familys' investment account worth periodically (usually yearly but can also be quarterly)

### Columns
- id (int4) - Auto generated unique ID
- investment_accounts_id (int4): Foreign key to the account id in investment_accounts
- activity_date (date): Date of the update
- amount (numeric): Amount of money in the account for the activity date


## transactions_manual
This table holds individual expenses or income added manually in the same format as `transactions` table

### Columns
- unique_id (text): ID of the transaction created by our systems
- account (text): Name or number of the account / credit card
- activity_date (date): Date of the transaction
- charged_amount (numeric): Amount which was charged from the account after currency conversions. Use this column for transaction charge amounts
- charged_currency (text): The currency which was charged from the account
- original_amount (numeric): Original amount of the transaction in original currency
- original_currency (text): Original currency of the transaction
- description (text): The name of the business
- identifier (text): ID of the transaction created by our the bank or credit card systems
- additional_info (text): Additional info about the transaction
- charged_date (timestamp): Date when the transaction will be charged from the account
- created_at (timestampz): Creation date of the transaction in the DB
- updated_at (timestampz): Update date of the transaction (If transactions grabber ran multiple times and fetched the transaction)
- cash_flow_type (enum cash_flow_type, default 'expense'): How this transaction is classified when deriving cash flow. Values: `salary`, `other_income`, `expense`, `savings`, `internal_transfer`