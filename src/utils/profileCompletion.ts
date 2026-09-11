export interface ProfileCompletionItem {
    label: string;
    tabKey: 'personal' | 'statutory' | 'documents' | 'shiftRoster' | 'salary' | 'team';
}

export interface ProfileCompletionResult {
    percentage: number;
    missingFields: string[];
    missingItems: ProfileCompletionItem[];
    completedFields: string[];
    isComplete: boolean;
}

export function calculateProfileCompletion(employee: any): ProfileCompletionResult {
    if (!employee) {
        return {
            percentage: 0,
            missingFields: [
                'Bank account details',
                'PAN and Aadhaar number',
                'Emergency contact'
            ],
            missingItems: [
                { label: 'Bank account details', tabKey: 'statutory' },
                { label: 'PAN and Aadhaar number', tabKey: 'statutory' },
                { label: 'Emergency contact', tabKey: 'personal' }
            ],
            completedFields: [],
            isComplete: false
        };
    }

    const profile = employee.employeeProfile || {};
    const statutory = profile.statutory || {};
    const bank = profile.bank || {};
    const salary = profile.salary || {};
    const documents = profile.documents || [];

    const checks: {
        name: string;
        label: string;
        tabKey: 'personal' | 'statutory' | 'documents' | 'shiftRoster' | 'salary' | 'team';
        weight: number;
        check: () => boolean;
    }[] = [
        {
            name: 'Basic Account Info',
            label: 'Account name & email',
            tabKey: 'personal',
            weight: 15,
            check: () => !!(employee.name?.trim() && employee.email?.trim())
        },
        {
            name: 'Designation & Department',
            label: 'Designation & Department',
            tabKey: 'personal',
            weight: 10,
            check: () => !!((profile.title || profile.designationId) && (profile.department || profile.departmentId))
        },
        {
            name: 'Bank Account Details',
            label: 'Bank account details',
            tabKey: 'statutory',
            weight: 15,
            check: () => {
                const bankName = bank.bankName?.trim();
                const acc = bank.accountNumber?.trim();
                const ifsc = bank.ifsc?.trim();
                return !!(bankName && bankName !== 'Not Provided' && 
                          acc && acc !== 'Not Provided' && 
                          ifsc && ifsc !== 'Not Provided');
            }
        },
        {
            name: 'Statutory Identity',
            label: 'PAN and Aadhaar number',
            tabKey: 'statutory',
            weight: 15,
            check: () => {
                const pan = statutory.pan?.trim();
                const aadhaar = statutory.aadhaar?.trim();
                return !!(pan && pan !== 'Not Provided' && aadhaar && aadhaar !== 'Not Provided');
            }
        },
        {
            name: 'Emergency Contact',
            label: 'Emergency contact',
            tabKey: 'personal',
            weight: 15,
            check: () => {
                const phone = (profile.phone || '').trim();
                const raw = phone.includes(' ') ? phone.split(' ')[1] : phone;
                return !!(raw && raw.length >= 10);
            }
        },
        {
            name: 'Profile Picture',
            label: 'Profile picture',
            tabKey: 'personal',
            weight: 10,
            check: () => {
                const avatar = profile.avatar || profile.profilePicture || employee.avatar;
                return !!(avatar && typeof avatar === 'string' && !avatar.startsWith('bg-'));
            }
        },
        {
            name: 'Shift Assignment',
            label: 'Shift assignment',
            tabKey: 'shiftRoster',
            weight: 10,
            check: () => !!(profile.shiftId || profile.shiftRef)
        },
        {
            name: 'Salary Info',
            label: 'Salary structure details',
            tabKey: 'salary',
            weight: 10,
            check: () => {
                const basic = Number(salary.basic || 0);
                const comps = Array.isArray(profile.salaryComponents) ? profile.salaryComponents.length : 0;
                return basic > 0 || comps > 0;
            }
        }
    ];

    let totalScore = 0;
    const missingFields: string[] = [];
    const missingItems: ProfileCompletionItem[] = [];
    const completedFields: string[] = [];

    for (const c of checks) {
        const passed = c.check();
        if (passed) {
            totalScore += c.weight;
            completedFields.push(c.name);
        } else {
            missingFields.push(c.label);
            missingItems.push({ label: c.label, tabKey: c.tabKey });
        }
    }

    const percentage = Math.min(100, Math.max(0, Math.round(totalScore)));

    return {
        percentage,
        missingFields,
        missingItems,
        completedFields,
        isComplete: percentage === 100
    };
}
