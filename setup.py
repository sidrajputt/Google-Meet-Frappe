from setuptools import find_packages, setup

with open("requirements.txt") as f:
	install_requires = f.read().strip().split("\n")
	install_requires = [line for line in install_requires if line and not line.startswith("#")]

setup(
	name="crm_meetings",
	version="1.0.0",
	description="Google Meet and Google Calendar meetings for Frappe CRM: guests, invitations, reminders, calendar, dashboard charts. Installs like any Frappe app.",
	author="Siddharth Singh",
	author_email="siddharth@codingpro.online",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires,
)
