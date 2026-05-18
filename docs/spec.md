# Task
I want to create a dashboard for my familys' personal finances. This includes an overview of our current financial assets (Investments, Pensions, etc...), monthly and yearly Household Cash Flow Tracker (Income/Expense/Savings), and lastly also transaction information from our accounts and credit cards with manually added categories and subcategories.
I tried creating these dashboards using Metabase but it was limited and not easy to maintain. Due to this I want to create a specialized dashboard for our needs described here.

Below are the requirements for the dashboards I want. In addition, there are requirements for pages where we can input manual data needed for the system.
The data model of the database can be found in data_model.md

# Tech stack
- Python 3.12+
- uv package manager
- Use virtual environment!
- git
- Streamlit for dashboard (I know this, so easy to maintain. If a different framework is better then convince me!)
- Plotly for graphs
- Pandas for data manipulation
- ruff for linting
- All of the data to query is in a Postgres DB

# Dashboards
## High level overview dashboard
Give an easy to understand overview of our current financial status:
- Net worth with a change percentage indicator of last year. If this could show overall and per parent and child this would be amazing.
- Pie chart of current net worth split by asset category: Investments, Pension, Hishtalmut, Bank Account, Rainy day fund
- Green and red bars of average monthly Income and expense (for this year, maybe in future be able to choose year?)
- Year over Year (YoY) Area chart per person (with ability to choose who to see and label amounts on the plot as well)
- Year over Year (YoY) line plot with lines for each asset category (plot per person or choose person if too cluttered)
- You may propose additional ideas!

## Household Cash Flow Tracker
Give an easy to understand view of our monthly cash flow:
- Table per parent with the following columns (potentially we can even make this a view in the DB and just query it): Year, Income, Expense (per account), Money transferred by friends for expenses,Total Expense, Savings, Income - Outcome, Savings %, Average monthly income, Average monthly expense
- Same table but aggregated for the whole household
- Some plots, maybe area chart income, expenses and Savings % .
- You may propose additional ideas!

## Transactions dashboard
Give an easy to understand overview and breakdown of our expenses excluding the "Travel" category which should have it's own dashboard:
- Data health signals (Last transaction date,  # of Uncategorized Transactions, % of Uncategorized Transactions)
- Year over Year (YoY) Bar chart
- Monthly Year-over-Year (YoY) Spend Trends (Bar chart with series per year)
- Average Monthly Spend per Year
- Average Monthly Spend per category (I think vertical bar chart would be best, but not sure)
- Subscription charge (Reoccurring expenses, might be different for a single month!)
- Line subplots for each category (Maybe this should be in a separate page/tab?)
- Top charged businesses (future work could include normalizing the names as same businesses can have different descriptions like UNITED39248092 and UNITED072347)
- Aggregate list of Uncategorized Transactions (maybe should be in the data input page?)
- Heat map of category and day of week (what day do we order takeout? what day do we go to get groceries?)
- You may propose additional ideas!

## Travel dashboard
Similar to Transactions dashboard but only for the travel category, with the following changes:
- Plots should use subcategory instead of category
- There might be several distinct trips each year. If possible it would be useful to aggregate per year and trip and not just by year (could be future improvement)

# Data input requirements
The transactions are categorized by category and subcategory.
I'd like to have a tab which allows easily adding these categories to transaction descriptions which don't have any mapped categories. The categories should be auto populated and then after choosing also the subcategories
In addition, some descriptions are broad and can apply to several different actual businesses (for example ordering food through a food delivery app - I'd prefer to have the name of the restaurant/deli/market I actually bought from). I'd like to have a page which allows inputting this. Perhaps we can make it generic so I can choose a specific description (e.g Venmo, Gift cards, etc...), we populate the transactions, remove those with mappings and then easily allow adding new mappings (with dropdown of existing ones)

Before proceeding make sure to ask any questions if anything is not clear!